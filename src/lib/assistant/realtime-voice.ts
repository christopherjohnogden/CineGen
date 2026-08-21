import { APPLY_DIRECTOR_CHANGES_TOOL, UNDO_VOICE_DIRECTOR_TOOL } from '@/lib/assistant/voice-director';

export type VoiceSessionStatus = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error' | 'closed';

export const VOICE_DIRECTOR_VOICES = [
  'alloy', 'ash', 'ballad', 'coral', 'echo',
  'sage', 'shimmer', 'verse', 'marin', 'cedar',
] as const;
export type VoiceDirectorVoice = typeof VOICE_DIRECTOR_VOICES[number];

export interface VoiceTranscriptEvent {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  final: boolean;
}

export interface VoiceToolResult {
  ok: boolean;
  message: string;
  [key: string]: unknown;
}

export interface VoiceDirectorSessionOptions {
  apiKey: string;
  voice: VoiceDirectorVoice;
  instructions: string;
  onStatus: (status: VoiceSessionStatus) => void;
  onTranscript: (event: VoiceTranscriptEvent) => void;
  onError: (message: string) => void;
  onToolCall: (name: string, args: unknown) => Promise<VoiceToolResult> | VoiceToolResult;
}

interface RealtimeEvent extends Record<string, unknown> {
  type?: string;
  item_id?: string;
  response_id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  delta?: string;
  transcript?: string;
  error?: { message?: string };
  item?: Record<string, unknown>;
}

function eventText(event: RealtimeEvent): string {
  if (typeof event.transcript === 'string') return event.transcript;
  if (typeof event.delta === 'string') return event.delta;
  if (typeof event.item?.transcript === 'string') return event.item.transcript;
  return '';
}

function eventId(event: RealtimeEvent, fallback: string): string {
  return (typeof event.item_id === 'string' && event.item_id)
    || (typeof event.response_id === 'string' && event.response_id)
    || (typeof event.item?.id === 'string' && event.item.id)
    || fallback;
}

export class VoiceDirectorSession {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private instructions: string;
  private handledCalls = new Set<string>();
  private closed = false;

  constructor(private readonly options: VoiceDirectorSessionOptions) {
    this.instructions = options.instructions;
  }

  async connect(): Promise<void> {
    this.options.onStatus('connecting');
    try {
      const createRealtimeSession = window.electronAPI?.llm?.openaiRealtimeSession;
      if (typeof createRealtimeSession !== 'function') {
        throw new Error(
          'CineGen needs to restart once to finish installing Voice Director. Quit and reopen CineGen, then try again.',
        );
      }

      const pc = new RTCPeerConnection();
      const audio = new Audio();
      audio.autoplay = true;
      pc.ontrack = (event) => {
        audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void audio.play().catch(() => {});
      };

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);

      const dc = pc.createDataChannel('oai-events');
      dc.addEventListener('open', () => {
        this.sendSessionUpdate();
        this.options.onStatus('listening');
      });
      dc.addEventListener('message', (message) => this.handleMessage(message.data));
      dc.addEventListener('close', () => {
        if (!this.closed) this.options.onStatus('closed');
      });
      dc.addEventListener('error', () => this.fail('The Voice Director connection was interrupted.'));

      this.pc = pc;
      this.dc = dc;
      this.stream = stream;
      this.audio = audio;

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const localSdp = offer.sdp ?? pc.localDescription?.sdp;
      if (!localSdp) throw new Error('Could not create the microphone session.');
      const answer = await createRealtimeSession({
        apiKey: this.options.apiKey,
        sdp: localSdp,
        voice: this.options.voice,
      });
      if (this.closed) return;
      await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
    } catch (error) {
      this.close();
      this.fail(error instanceof Error ? error.message : 'Voice Director could not start.');
      throw error;
    }
  }

  updateInstructions(instructions: string): void {
    this.instructions = instructions;
    if (this.dc?.readyState === 'open') this.sendSessionUpdate();
  }

  setMuted(muted: boolean): void {
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = !muted;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    if (this.dc && this.dc.readyState !== 'closed') this.dc.close();
    this.dc = null;
    this.pc?.close();
    this.pc = null;
    if (this.audio) {
      this.audio.pause();
      this.audio.srcObject = null;
    }
    this.audio = null;
    this.options.onStatus('closed');
  }

  private send(event: Record<string, unknown>): void {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(event));
  }

  private sendSessionUpdate(): void {
    this.send({
      type: 'session.update',
      session: {
        type: 'realtime',
        model: 'gpt-realtime-2.1',
        instructions: this.instructions,
        audio: {
          input: {
            transcription: { model: 'gpt-4o-mini-transcribe' },
            turn_detection: {
              type: 'semantic_vad',
              eagerness: 'auto',
              create_response: true,
              interrupt_response: true,
            },
          },
          output: { voice: this.options.voice },
        },
        tools: [APPLY_DIRECTOR_CHANGES_TOOL, UNDO_VOICE_DIRECTOR_TOOL],
        tool_choice: 'auto',
      },
    });
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let event: RealtimeEvent;
    try {
      event = JSON.parse(raw) as RealtimeEvent;
    } catch {
      return;
    }
    const type = event.type ?? '';

    if (type === 'error') {
      this.fail(event.error?.message ?? 'OpenAI Realtime returned an error.');
      return;
    }
    if (type === 'input_audio_buffer.speech_started') {
      this.options.onStatus('listening');
      return;
    }
    if (type === 'input_audio_buffer.speech_stopped' || type === 'response.created') {
      this.options.onStatus('thinking');
      return;
    }
    if (type === 'response.audio.delta' || type === 'response.output_audio.delta') {
      this.options.onStatus('speaking');
      return;
    }
    if (type === 'conversation.item.input_audio_transcription.completed') {
      const transcript = eventText(event).trim();
      if (transcript) this.options.onTranscript({
        id: eventId(event, `user-${Date.now()}`), role: 'user', text: transcript, final: true,
      });
      return;
    }
    if (type === 'response.audio_transcript.delta' || type === 'response.output_audio_transcript.delta') {
      const delta = eventText(event);
      if (delta) this.options.onTranscript({
        id: eventId(event, 'assistant-current'), role: 'assistant', text: delta, final: false,
      });
      this.options.onStatus('speaking');
      return;
    }
    if (type === 'response.audio_transcript.done' || type === 'response.output_audio_transcript.done') {
      const transcript = eventText(event).trim();
      if (transcript) this.options.onTranscript({
        id: eventId(event, 'assistant-current'), role: 'assistant', text: transcript, final: true,
      });
      return;
    }
    if (type === 'response.function_call_arguments.done') {
      void this.handleToolCall(event.call_id, event.name, event.arguments);
      return;
    }
    if (type === 'response.output_item.done' && event.item?.type === 'function_call') {
      void this.handleToolCall(
        typeof event.item.call_id === 'string' ? event.item.call_id : undefined,
        typeof event.item.name === 'string' ? event.item.name : undefined,
        typeof event.item.arguments === 'string' ? event.item.arguments : undefined,
      );
      return;
    }
    if (type === 'response.done') this.options.onStatus('listening');
  }

  private async handleToolCall(callId: string | undefined, name: string | undefined, argsJson: string | undefined): Promise<void> {
    if (!callId || !name || this.handledCalls.has(callId)) return;
    this.handledCalls.add(callId);
    this.options.onStatus('thinking');
    let args: unknown = {};
    try {
      args = argsJson ? JSON.parse(argsJson) : {};
    } catch {
      args = {};
    }
    let result: VoiceToolResult;
    try {
      result = await this.options.onToolCall(name, args);
    } catch (error) {
      result = { ok: false, message: error instanceof Error ? error.message : 'CineGen could not apply that change.' };
    }
    this.options.onTranscript({
      id: `tool-${callId}`,
      role: 'system',
      text: result.message,
      final: true,
    });
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(result),
      },
    });
    this.send({ type: 'response.create' });
  }

  private fail(message: string): void {
    this.options.onStatus('error');
    this.options.onError(message);
  }
}
