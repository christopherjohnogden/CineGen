#include <napi.h>

#import <AVFoundation/AVFoundation.h>
#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>

#include <cmath>
#include <memory>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

@interface NativeVideoSurfaceView : NSView
@end

@implementation NativeVideoSurfaceView
- (instancetype)initWithFrame:(NSRect)frame {
  self = [super initWithFrame:frame];
  if (self) {
    self.wantsLayer = YES;
    self.layer = [CALayer layer];
    self.layer.backgroundColor = NSColor.clearColor.CGColor;
    self.layer.masksToBounds = YES;
  }
  return self;
}

- (BOOL)isFlipped {
  return YES;
}

- (NSView*)hitTest:(NSPoint)point {
  (void)point;
  return nil;
}
@end

namespace {

static constexpr double kPlaySeekThresholdSeconds = 1.2;
static constexpr double kPauseSeekThresholdSeconds = 1.0 / 60.0;
static constexpr int32_t kTimeScale = 600;
static constexpr double kStartupGraceWindowSeconds = 1.5;
static constexpr double kPreviewJpegQuality = 0.72;

void RunOnMainSync(dispatch_block_t block) {
  if ([NSThread isMainThread]) {
    block();
    return;
  }
  dispatch_sync(dispatch_get_main_queue(), block);
}

NSString* ToNSString(const std::string& value) {
  return [NSString stringWithUTF8String:value.c_str() ?: ""];
}

std::string ToStdString(Napi::Value value) {
  return value.IsString() ? value.As<Napi::String>().Utf8Value() : std::string();
}

NSURL* URLForSourceString(const std::string& source) {
  if (source.empty()) return nil;
  NSString* value = ToNSString(source);
  if ([value hasPrefix:@"http://"] || [value hasPrefix:@"https://"] || [value hasPrefix:@"file://"]) {
    return [NSURL URLWithString:value];
  }
  return [NSURL fileURLWithPath:value];
}

double SafeAssetDurationSeconds(AVAsset* asset) {
  if (!asset) return 0.0;
  const double duration = CMTimeGetSeconds(asset.duration);
  return std::isfinite(duration) && duration > 0 ? duration : 0.0;
}

double ClampedPreviewTime(double duration, double normalizedPosition) {
  if (!(duration > 0)) return 0.0;
  const double clamped = std::max(0.0, std::min(1.0, normalizedPosition));
  const double target = duration * clamped;
  return std::max(0.0, std::min(duration - 0.05, target));
}

bool EnsureParentDirectory(NSString* outputPath, NSError** error) {
  NSString* parent = [outputPath stringByDeletingLastPathComponent];
  if (parent.length == 0) return true;
  return [[NSFileManager defaultManager] createDirectoryAtPath:parent withIntermediateDirectories:YES attributes:nil error:error];
}

bool WriteJpeg(CGImageRef image, NSString* outputPath, CGFloat quality, NSError** error) {
  if (image == nil || outputPath.length == 0) return false;
  if (!EnsureParentDirectory(outputPath, error)) return false;
  NSBitmapImageRep* rep = [[NSBitmapImageRep alloc] initWithCGImage:image];
  if (rep == nil) {
    if (error) {
      *error = [NSError errorWithDomain:@"cinegen.avfoundation" code:1001 userInfo:@{NSLocalizedDescriptionKey: @"Failed to create bitmap representation"}];
    }
    return false;
  }
  NSData* data = [rep representationUsingType:NSBitmapImageFileTypeJPEG properties:@{ NSImageCompressionFactor: @(quality) }];
  if (data == nil) {
    if (error) {
      *error = [NSError errorWithDomain:@"cinegen.avfoundation" code:1002 userInfo:@{NSLocalizedDescriptionKey: @"Failed to encode JPEG"}];
    }
    return false;
  }
  return [data writeToFile:outputPath options:NSDataWritingAtomic error:error];
}

void DisableImplicitLayerAnimations(CALayer* layer) {
  if (layer == nil) return;
  layer.actions = @{
    @"bounds": [NSNull null],
    @"position": [NSNull null],
    @"frame": [NSNull null],
    @"opacity": [NSNull null],
    @"hidden": [NSNull null],
    @"transform": [NSNull null],
    @"contents": [NSNull null],
    @"zPosition": [NSNull null],
  };
}

NSMutableDictionary<NSString*, AVURLAsset*>* SharedAssetCache() {
  static NSMutableDictionary<NSString*, AVURLAsset*>* cache = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    cache = [[NSMutableDictionary alloc] init];
  });
  return cache;
}

AVURLAsset* CachedAssetForSource(const std::string& source) {
  if (source.empty()) return nil;
  NSString* key = ToNSString(source);
  NSMutableDictionary<NSString*, AVURLAsset*>* cache = SharedAssetCache();
  AVURLAsset* asset = cache[key];
  if (asset != nil) return asset;

  NSURL* url = URLForSourceString(source);
  if (url == nil) return nil;

  asset = [AVURLAsset URLAssetWithURL:url options:nil];
  cache[key] = asset;
  [asset loadValuesAsynchronouslyForKeys:@[@"playable", @"tracks"] completionHandler:^{}];
  return asset;
}

CGImageRef CopyPreviewFrame(AVAssetImageGenerator* generator, double timeSeconds, NSError** error) {
  const CMTime requestedTime = CMTimeMakeWithSeconds(std::max(0.0, timeSeconds), kTimeScale);
  CMTime actualTime = kCMTimeZero;
  return [generator copyCGImageAtTime:requestedTime actualTime:&actualTime error:error];
}

NSView* HostViewFromHandle(const Napi::Buffer<uint8_t>& handleBuffer) {
  if (handleBuffer.Length() < sizeof(void*)) return nil;
  void* ptr = *reinterpret_cast<void**>(handleBuffer.Data());
  if (!ptr) return nil;

  id obj = (__bridge id)ptr;
  if ([obj isKindOfClass:[NSWindow class]]) {
    return [(NSWindow*)obj contentView];
  }
  if ([obj isKindOfClass:[NSView class]]) {
    NSView* view = (NSView*)obj;
    NSWindow* window = [view window];
    if (window != nil && [window contentView] != nil) return [window contentView];
    return view;
  }
  return nil;
}

enum class RenderItemKind {
  Video,
  Image,
};

struct RenderItemDescriptor {
  std::string id;
  RenderItemKind kind = RenderItemKind::Video;
  std::string source;
  double currentTime = 0;
  double rate = 1;
  double opacity = 1;
  double zIndex = 0;
  bool visible = true;
  bool playing = false;
  bool muted = true;
  bool flipH = false;
  bool flipV = false;
};

class RenderItemState {
public:
  RenderItemState(RenderItemKind kind, NativeVideoSurfaceView* surfaceView)
    : kind_(kind), surfaceView_(surfaceView) {}

  ~RenderItemState() {
    teardown();
  }

  void update(const RenderItemDescriptor& descriptor) {
    if (kind_ != descriptor.kind || source_ != descriptor.source) {
      recreateBacking(descriptor.kind, descriptor.source);
    }

    if (kind_ == RenderItemKind::Image) {
      applyLayerState(descriptor, true);
      return;
    }
    if (!player_) return;

    lastRequestedTime_ = descriptor.currentTime;
    player_.muted = descriptor.muted;
    const double playerTime = CMTimeGetSeconds(player_.currentTime);
    const bool validPlayerTime = std::isfinite(playerTime);
    const double drift = validPlayerTime ? std::fabs(playerTime - descriptor.currentTime) : descriptor.currentTime;
    const CMTime targetTime = CMTimeMakeWithSeconds(std::max(0.0, descriptor.currentTime), kTimeScale);
    const CMTime tolerance = CMTimeMake(1, 120);
    const CFTimeInterval now = CACurrentMediaTime();
    if (descriptor.playing) {
      pauseSeekInFlight_ = false;
      setPlayerLayerAttached(true);
      applyLayerState(descriptor, true);
      setPausedFrameVisible(descriptor, false);
      hasResolvedPausedFrame_ = true;
      wasPlayingLastUpdate_ = true;
      wantsToPlay_ = true;
      if (!didPrimePlayback_) {
        didPrimePlayback_ = true;
        startupGraceUntil_ = now + kStartupGraceWindowSeconds;
        [player_ seekToTime:targetTime toleranceBefore:tolerance toleranceAfter:tolerance];
      } else if (!isStartingPlayback_ && now >= startupGraceUntil_ && (!validPlayerTime || drift > kPlaySeekThresholdSeconds)) {
        [player_ seekToTime:targetTime toleranceBefore:tolerance toleranceAfter:tolerance];
      }
      if (!isStartingPlayback_ && (std::fabs(player_.rate - descriptor.rate) > 0.01 || player_.timeControlStatus != AVPlayerTimeControlStatusPlaying)) {
        isStartingPlayback_ = true;
        startupGraceUntil_ = now + kStartupGraceWindowSeconds;
        const double desiredRate = descriptor.rate;
        // Guard: prerollAtRate: throws NSInternalInconsistencyException if the
        // player item is not yet ready (e.g. immediately after creation at a cut
        // point). Skip preroll when not ready; next sync call will retry.
        if (player_.status == AVPlayerStatusReadyToPlay) {
          @try {
            [player_ prerollAtRate:desiredRate completionHandler:^(BOOL finished) {
              RunOnMainSync(^{
                this->isStartingPlayback_ = false;
                if (!this->player_ || !this->wantsToPlay_) return;
                const CMTime latestTarget = CMTimeMakeWithSeconds(std::max(0.0, this->lastRequestedTime_), kTimeScale);
                [this->player_ seekToTime:latestTarget toleranceBefore:tolerance toleranceAfter:tolerance];
                @try { [this->player_ playImmediatelyAtRate:desiredRate]; } @catch (...) {}
              });
            }];
          } @catch (...) {
            isStartingPlayback_ = false;
          }
        } else {
          isStartingPlayback_ = false;
        }
      } else if (player_.timeControlStatus == AVPlayerTimeControlStatusPaused && !isStartingPlayback_) {
        @try { [player_ playImmediatelyAtRate:descriptor.rate]; } @catch (...) {}
      }
    } else {
      wasPlayingLastUpdate_ = false;
      wantsToPlay_ = false;
      isStartingPlayback_ = false;
      pauseSeekInFlight_ = false;
      if (player_.rate != 0.0f) {
        [player_ pause];
      }
      setPlayerLayerAttached(true);
      if (!validPlayerTime || drift > kPauseSeekThresholdSeconds) {
        [player_ seekToTime:targetTime toleranceBefore:tolerance toleranceAfter:tolerance];
      }
      const bool hasPausedFrame = ensurePausedFrame(descriptor.currentTime);
      applyLayerState(descriptor, true);
      setPausedFrameVisible(descriptor, hasPausedFrame);
      hasResolvedPausedFrame_ = hasResolvedPausedFrame_ || hasPausedFrame;
    }
  }

  void layout() {
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    if (playerLayer_) playerLayer_.frame = surfaceView_.bounds;
    if (imageLayer_) imageLayer_.frame = surfaceView_.bounds;
    if (pausedFrameLayer_) pausedFrameLayer_.frame = surfaceView_.bounds;
    [CATransaction commit];
  }

  const std::string& source() const { return source_; }

private:
  void setPlayerLayerAttached(bool attached) {
    if (!playerLayer_) return;
    if (attached) {
      if (!playerLayerAttached_) {
        playerLayer_.player = player_;
        playerLayerAttached_ = true;
      }
    } else if (playerLayerAttached_) {
      playerLayer_.player = nil;
      playerLayerAttached_ = false;
    }
  }

  void applyLayerState(const RenderItemDescriptor& descriptor, bool allowVisible) {
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    if (playerLayer_) {
      playerLayer_.frame = surfaceView_.bounds;
      playerLayer_.opacity = descriptor.visible && allowVisible ? static_cast<float>(descriptor.opacity) : 0.0f;
      playerLayer_.hidden = !descriptor.visible || !allowVisible;
      playerLayer_.zPosition = static_cast<CGFloat>(descriptor.zIndex);
      playerLayer_.transform = CATransform3DMakeScale(descriptor.flipH ? -1.0 : 1.0, descriptor.flipV ? -1.0 : 1.0, 1.0);
    }
    if (imageLayer_) {
      imageLayer_.frame = surfaceView_.bounds;
      imageLayer_.opacity = descriptor.visible && allowVisible ? static_cast<float>(descriptor.opacity) : 0.0f;
      imageLayer_.hidden = !descriptor.visible || !allowVisible;
      imageLayer_.zPosition = static_cast<CGFloat>(descriptor.zIndex);
      imageLayer_.transform = CATransform3DMakeScale(descriptor.flipH ? -1.0 : 1.0, descriptor.flipV ? -1.0 : 1.0, 1.0);
    }
    [CATransaction commit];
  }

  void setPausedFrameVisible(const RenderItemDescriptor& descriptor, bool visible) {
    if (!pausedFrameLayer_) return;
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    pausedFrameLayer_.frame = surfaceView_.bounds;
    pausedFrameLayer_.opacity = descriptor.visible && visible ? static_cast<float>(descriptor.opacity) : 0.0f;
    pausedFrameLayer_.hidden = !descriptor.visible || !visible;
    pausedFrameLayer_.zPosition = static_cast<CGFloat>(descriptor.zIndex + 1000.0);
    pausedFrameLayer_.transform = CATransform3DMakeScale(descriptor.flipH ? -1.0 : 1.0, descriptor.flipV ? -1.0 : 1.0, 1.0);
    [CATransaction commit];
  }

  bool ensurePausedFrame(double timeSeconds) {
    if (!imageGenerator_ || !pausedFrameLayer_) return false;
    if (pausedFrameLayer_.contents != nil && std::fabs(pausedFrameTime_ - timeSeconds) <= kPauseSeekThresholdSeconds) {
      return true;
    }
    NSError* imageError = nil;
    CGImageRef image = CopyPreviewFrame(imageGenerator_, timeSeconds, &imageError);
    if (image == nil) {
      return pausedFrameLayer_.contents != nil;
    }
    pausedFrameLayer_.contents = (__bridge id)image;
    pausedFrameTime_ = timeSeconds;
    CGImageRelease(image);
    return true;
  }

  // Fast variant: uses relaxed tolerance (snaps to nearest keyframe) to avoid
  // blocking the main thread while fetching a cover frame during playback transitions.
  void ensurePausedFrameFast(double timeSeconds) {
    if (!pausedFrameLayer_) return;
    // If we already have a reasonably close frame, keep it
    if (pausedFrameLayer_.contents != nil && std::fabs(pausedFrameTime_ - timeSeconds) <= 1.0) return;
    AVURLAsset* asset = CachedAssetForSource(source_);
    if (!asset) return;
    AVAssetImageGenerator* fastGen = [[AVAssetImageGenerator alloc] initWithAsset:asset];
    fastGen.appliesPreferredTrackTransform = YES;
    fastGen.requestedTimeToleranceBefore = CMTimeMakeWithSeconds(1.0, kTimeScale);
    fastGen.requestedTimeToleranceAfter  = CMTimeMakeWithSeconds(1.0, kTimeScale);
    const CMTime t = CMTimeMakeWithSeconds(std::max(0.0, timeSeconds), kTimeScale);
    NSError* err = nil;
    CGImageRef image = [fastGen copyCGImageAtTime:t actualTime:nil error:&err];
    if (image != nil) {
      pausedFrameLayer_.contents = (__bridge id)image;
      pausedFrameTime_ = timeSeconds;
      CGImageRelease(image);
    }
  }

  void recreateBacking(RenderItemKind kind, const std::string& source) {
    teardown();

    kind_ = kind;
    source_ = source;
    CALayer* containerLayer = surfaceView_.layer;
    if (!containerLayer) return;

    if (kind_ == RenderItemKind::Image) {
      imageLayer_ = [CALayer layer];
      DisableImplicitLayerAnimations(imageLayer_);
      imageLayer_.frame = surfaceView_.bounds;
      imageLayer_.contentsGravity = kCAGravityResizeAspect;
      NSURL* url = URLForSourceString(source_);
      NSImage* image = nil;
      if (url != nil) {
        if (url.isFileURL) image = [[NSImage alloc] initWithContentsOfFile:url.path];
        else image = [[NSImage alloc] initWithContentsOfURL:url];
      }
      if (image != nil) {
        imageLayer_.contents = image;
      }
      [containerLayer addSublayer:imageLayer_];
      hasResolvedPausedFrame_ = true;
      return;
    }

    AVURLAsset* asset = CachedAssetForSource(source_);
    if (asset == nil) return;
    playerItem_ = [AVPlayerItem playerItemWithAsset:asset];
    playerItem_.preferredForwardBufferDuration = 0;
    player_ = [AVPlayer playerWithPlayerItem:playerItem_];
    player_.actionAtItemEnd = AVPlayerActionAtItemEndPause;
    player_.automaticallyWaitsToMinimizeStalling = NO;
    player_.muted = YES;
    imageGenerator_ = [[AVAssetImageGenerator alloc] initWithAsset:asset];
    imageGenerator_.appliesPreferredTrackTransform = YES;
    imageGenerator_.requestedTimeToleranceBefore = kCMTimeZero;
    imageGenerator_.requestedTimeToleranceAfter = kCMTimeZero;

    playerLayer_ = [AVPlayerLayer playerLayerWithPlayer:player_];
    DisableImplicitLayerAnimations(playerLayer_);
    playerLayer_.frame = surfaceView_.bounds;
    playerLayer_.videoGravity = AVLayerVideoGravityResizeAspect;
    playerLayerAttached_ = true;
    [containerLayer addSublayer:playerLayer_];

    pausedFrameLayer_ = [CALayer layer];
    DisableImplicitLayerAnimations(pausedFrameLayer_);
    pausedFrameLayer_.frame = surfaceView_.bounds;
    pausedFrameLayer_.contentsGravity = kCAGravityResizeAspect;
    pausedFrameLayer_.hidden = YES;
    pausedFrameLayer_.opacity = 0.0f;
    [containerLayer addSublayer:pausedFrameLayer_];
  }

  void teardown() {
    if (player_) {
      [player_ pause];
      [player_ replaceCurrentItemWithPlayerItem:nil];
      player_ = nil;
    }
    playerItem_ = nil;
    imageGenerator_ = nil;
    if (playerLayer_) {
      [playerLayer_ removeFromSuperlayer];
      playerLayer_ = nil;
    }
    if (pausedFrameLayer_) {
      pausedFrameLayer_.contents = nil;
      [pausedFrameLayer_ removeFromSuperlayer];
      pausedFrameLayer_ = nil;
    }
    if (imageLayer_) {
      [imageLayer_ removeFromSuperlayer];
      imageLayer_ = nil;
    }
    didPrimePlayback_ = false;
    isStartingPlayback_ = false;
    wantsToPlay_ = false;
    pauseSeekInFlight_ = false;
    pauseSeekTargetTime_ = 0;
    playerLayerAttached_ = false;
    startupGraceUntil_ = 0;
    lastRequestedTime_ = 0;
    hasResolvedPausedFrame_ = false;
    wasPlayingLastUpdate_ = false;
    pausedFrameTime_ = -1;
    source_.clear();
  }

  CALayer* layerHandle() const {
    return kind_ == RenderItemKind::Image ? imageLayer_ : playerLayer_;
  }

  RenderItemKind kind_;
  __strong NativeVideoSurfaceView* surfaceView_ = nil;
  std::string source_;
  __strong AVPlayer* player_ = nil;
  __strong AVPlayerItem* playerItem_ = nil;
  __strong AVAssetImageGenerator* imageGenerator_ = nil;
  __strong AVPlayerLayer* playerLayer_ = nil;
  __strong CALayer* pausedFrameLayer_ = nil;
  __strong CALayer* imageLayer_ = nil;
  bool didPrimePlayback_ = false;
  bool isStartingPlayback_ = false;
  bool wantsToPlay_ = false;
  bool pauseSeekInFlight_ = false;
  double pauseSeekTargetTime_ = 0;
  bool playerLayerAttached_ = false;
  CFTimeInterval startupGraceUntil_ = 0;
  double lastRequestedTime_ = 0;
  bool hasResolvedPausedFrame_ = false;
  bool wasPlayingLastUpdate_ = false;
  double pausedFrameTime_ = -1;
};

struct SurfaceState {
  __strong NSView* hostView = nil;
  __strong NativeVideoSurfaceView* surfaceView = nil;
  std::unordered_map<std::string, std::unique_ptr<RenderItemState>> items;
};

class SurfaceManager {
public:
  static SurfaceManager& shared() {
    static SurfaceManager manager;
    return manager;
  }

  bool createSurface(const std::string& surfaceId, const Napi::Buffer<uint8_t>& handleBuffer) {
    __block bool success = false;
    RunOnMainSync(^{
      NSView* hostView = HostViewFromHandle(handleBuffer);
      if (!hostView) return;

      auto& state = surfaces_[surfaceId];
      if (!state.surfaceView) {
        state.hostView = hostView;
        state.surfaceView = [[NativeVideoSurfaceView alloc] initWithFrame:NSZeroRect];
        state.surfaceView.hidden = YES;
        [hostView addSubview:state.surfaceView positioned:NSWindowAbove relativeTo:nil];
      } else if (state.hostView != hostView) {
        [state.surfaceView removeFromSuperview];
        state.hostView = hostView;
        [hostView addSubview:state.surfaceView positioned:NSWindowAbove relativeTo:nil];
      }
      success = true;
    });
    return success;
  }

  void destroySurface(const std::string& surfaceId) {
    RunOnMainSync(^{
      auto it = surfaces_.find(surfaceId);
      if (it == surfaces_.end()) return;
      if (it->second.surfaceView) {
        [it->second.surfaceView removeFromSuperview];
        it->second.surfaceView = nil;
      }
      it->second.hostView = nil;
      it->second.items.clear();
      surfaces_.erase(it);
    });
  }

  void setSurfaceRect(const std::string& surfaceId, double x, double y, double width, double height) {
    RunOnMainSync(^{
      auto it = surfaces_.find(surfaceId);
      if (it == surfaces_.end()) return;
      SurfaceState& state = it->second;
      if (!state.surfaceView || !state.hostView) return;
      const CGFloat safeWidth = std::max(0.0, width);
      const CGFloat safeHeight = std::max(0.0, height);
      const CGFloat hostHeight = NSHeight(state.hostView.bounds);
      NSRect frame = NSMakeRect(x, y, safeWidth, safeHeight);
      if (![state.hostView isFlipped]) {
        frame.origin.y = hostHeight - y - safeHeight;
      }
      state.surfaceView.frame = frame;
      for (auto& [_, item] : state.items) {
        item->layout();
      }
    });
  }

  void setSurfaceHidden(const std::string& surfaceId, bool hidden) {
    RunOnMainSync(^{
      auto it = surfaces_.find(surfaceId);
      if (it == surfaces_.end()) return;
      if (it->second.surfaceView) {
        it->second.surfaceView.hidden = hidden;
      }
    });
  }

  void clearSurface(const std::string& surfaceId) {
    RunOnMainSync(^{
      auto it = surfaces_.find(surfaceId);
      if (it == surfaces_.end()) return;
      it->second.items.clear();
      if (it->second.surfaceView) {
        it->second.surfaceView.hidden = YES;
      }
    });
  }

  void syncSurface(const std::string& surfaceId, const std::vector<RenderItemDescriptor>& descriptors) {
    RunOnMainSync(^{
      auto surfaceIt = surfaces_.find(surfaceId);
      if (surfaceIt == surfaces_.end()) return;
      SurfaceState& surface = surfaceIt->second;
      if (!surface.surfaceView) return;

      std::unordered_set<std::string> nextIds;
      nextIds.reserve(descriptors.size());
      for (const auto& descriptor : descriptors) {
        nextIds.insert(descriptor.id);
      }

      // Build a source→id map for outgoing items so we can transfer an existing
      // RenderItemState to an incoming item that shares the same source file.
      // This is the common case at blade-cut transitions: two consecutive clips
      // from the same file swap IDs but need the same AVPlayer to keep playing.
      std::unordered_map<std::string, std::string> outgoingSourceToId;
      for (auto& [id, item] : surface.items) {
        if (!nextIds.contains(id)) {
          const std::string& src = item->source();
          if (!src.empty()) outgoingSourceToId[src] = id;
        }
      }

      // For each incoming descriptor that has no existing item but whose source
      // matches an outgoing item: re-key the existing RenderItemState instead of
      // destroying and recreating it. The player keeps running uninterrupted.
      for (const auto& descriptor : descriptors) {
        if (surface.items.count(descriptor.id)) continue;  // already exists
        auto srcIt = outgoingSourceToId.find(descriptor.source);
        if (srcIt == outgoingSourceToId.end()) continue;
        const std::string& donorId = srcIt->second;
        auto donorIt = surface.items.find(donorId);
        if (donorIt == surface.items.end()) continue;
        // Transfer ownership: move the live state under the new clip ID
        surface.items[descriptor.id] = std::move(donorIt->second);
        surface.items.erase(donorIt);
        outgoingSourceToId.erase(srcIt);
      }

      // Remove items that are truly no longer needed
      for (auto it = surface.items.begin(); it != surface.items.end();) {
        if (!nextIds.contains(it->first)) {
          it = surface.items.erase(it);
        } else {
          ++it;
        }
      }

      for (const auto& descriptor : descriptors) {
        auto itemIt = surface.items.find(descriptor.id);
        if (itemIt == surface.items.end()) {
          itemIt = surface.items.emplace(
            descriptor.id,
            std::make_unique<RenderItemState>(descriptor.kind, surface.surfaceView)
          ).first;
        }
        itemIt->second->update(descriptor);
      }

      surface.surfaceView.hidden = descriptors.empty();
    });
  }

private:
  std::unordered_map<std::string, SurfaceState> surfaces_;
};

RenderItemDescriptor ParseDescriptor(const Napi::Object& object) {
  RenderItemDescriptor descriptor;
  descriptor.id = ToStdString(object.Get("id"));
  const std::string kind = ToStdString(object.Get("kind"));
  descriptor.kind = kind == "image" ? RenderItemKind::Image : RenderItemKind::Video;
  descriptor.source = ToStdString(object.Get("source"));
  if (object.Has("currentTime")) descriptor.currentTime = object.Get("currentTime").ToNumber().DoubleValue();
  if (object.Has("rate")) descriptor.rate = object.Get("rate").ToNumber().DoubleValue();
  if (object.Has("opacity")) descriptor.opacity = object.Get("opacity").ToNumber().DoubleValue();
  if (object.Has("zIndex")) descriptor.zIndex = object.Get("zIndex").ToNumber().DoubleValue();
  if (object.Has("visible")) descriptor.visible = object.Get("visible").ToBoolean().Value();
  if (object.Has("playing")) descriptor.playing = object.Get("playing").ToBoolean().Value();
  if (object.Has("muted")) descriptor.muted = object.Get("muted").ToBoolean().Value();
  if (object.Has("flipH")) descriptor.flipH = object.Get("flipH").ToBoolean().Value();
  if (object.Has("flipV")) descriptor.flipV = object.Get("flipV").ToBoolean().Value();
  return descriptor;
}

Napi::Value CreateSurface(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsBuffer()) {
    Napi::TypeError::New(env, "Expected surfaceId and native window handle buffer").ThrowAsJavaScriptException();
    return env.Null();
  }

  const std::string surfaceId = info[0].As<Napi::String>().Utf8Value();
  const auto handleBuffer = info[1].As<Napi::Buffer<uint8_t>>();
  const bool created = SurfaceManager::shared().createSurface(surfaceId, handleBuffer);
  return Napi::Boolean::New(env, created);
}

Napi::Value DestroySurface(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected surfaceId").ThrowAsJavaScriptException();
    return env.Null();
  }
  SurfaceManager::shared().destroySurface(info[0].As<Napi::String>().Utf8Value());
  return env.Undefined();
}

Napi::Value SetSurfaceRect(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 5 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected surfaceId, x, y, width, height").ThrowAsJavaScriptException();
    return env.Null();
  }
  SurfaceManager::shared().setSurfaceRect(
    info[0].As<Napi::String>().Utf8Value(),
    info[1].ToNumber().DoubleValue(),
    info[2].ToNumber().DoubleValue(),
    info[3].ToNumber().DoubleValue(),
    info[4].ToNumber().DoubleValue()
  );
  return env.Undefined();
}

Napi::Value SetSurfaceHidden(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsBoolean()) {
    Napi::TypeError::New(env, "Expected surfaceId and hidden flag").ThrowAsJavaScriptException();
    return env.Null();
  }
  SurfaceManager::shared().setSurfaceHidden(
    info[0].As<Napi::String>().Utf8Value(),
    info[1].ToBoolean().Value()
  );
  return env.Undefined();
}

Napi::Value ClearSurface(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected surfaceId").ThrowAsJavaScriptException();
    return env.Null();
  }
  SurfaceManager::shared().clearSurface(info[0].As<Napi::String>().Utf8Value());
  return env.Undefined();
}

Napi::Value SyncSurface(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsArray()) {
    Napi::TypeError::New(env, "Expected surfaceId and descriptor array").ThrowAsJavaScriptException();
    return env.Null();
  }

  const std::string surfaceId = info[0].As<Napi::String>().Utf8Value();
  const Napi::Array descriptors = info[1].As<Napi::Array>();
  std::vector<RenderItemDescriptor> next;
  next.reserve(descriptors.Length());
  for (uint32_t i = 0; i < descriptors.Length(); i += 1) {
    Napi::Value value = descriptors.Get(i);
    if (!value.IsObject()) continue;
    next.push_back(ParseDescriptor(value.As<Napi::Object>()));
  }
  SurfaceManager::shared().syncSurface(surfaceId, next);
  return env.Undefined();
}

Napi::Value GenerateThumbnail(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::TypeError::New(env, "Expected source path and output path").ThrowAsJavaScriptException();
    return env.Null();
  }

  const std::string source = info[0].As<Napi::String>().Utf8Value();
  const std::string outputPath = info[1].As<Napi::String>().Utf8Value();
  const double normalizedPosition = (info.Length() >= 3 && info[2].IsNumber())
    ? info[2].As<Napi::Number>().DoubleValue()
    : 0.5;

  NSURL* url = URLForSourceString(source);
  if (url == nil) {
    Napi::Error::New(env, "Invalid media source").ThrowAsJavaScriptException();
    return env.Null();
  }

  AVURLAsset* asset = [AVURLAsset URLAssetWithURL:url options:@{ AVURLAssetPreferPreciseDurationAndTimingKey: @NO }];
  AVAssetImageGenerator* generator = [[AVAssetImageGenerator alloc] initWithAsset:asset];
  generator.appliesPreferredTrackTransform = YES;
  generator.maximumSize = CGSizeMake(512, 512);
  generator.requestedTimeToleranceBefore = kCMTimePositiveInfinity;
  generator.requestedTimeToleranceAfter = kCMTimePositiveInfinity;

  NSError* imageError = nil;
  const double duration = SafeAssetDurationSeconds(asset);
  const double targetTime = ClampedPreviewTime(duration, normalizedPosition);
  CGImageRef image = CopyPreviewFrame(generator, targetTime, &imageError);
  if (image == nil) {
    Napi::Error::New(env, imageError ? imageError.localizedDescription.UTF8String : "Failed to extract thumbnail").ThrowAsJavaScriptException();
    return env.Null();
  }

  NSError* writeError = nil;
  const bool wrote = WriteJpeg(image, ToNSString(outputPath), kPreviewJpegQuality, &writeError);
  CGImageRelease(image);
  if (!wrote) {
    Napi::Error::New(env, writeError ? writeError.localizedDescription.UTF8String : "Failed to write thumbnail").ThrowAsJavaScriptException();
    return env.Null();
  }

  return Napi::String::New(env, outputPath);
}

Napi::Value GenerateFilmstripFrames(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 5 || !info[0].IsString() || !info[1].IsString() || !info[2].IsString() || !info[3].IsNumber() || !info[4].IsNumber()) {
    Napi::TypeError::New(env, "Expected source path, output dir, prefix, frame count, frame width").ThrowAsJavaScriptException();
    return env.Null();
  }

  const std::string source = info[0].As<Napi::String>().Utf8Value();
  const std::string outputDir = info[1].As<Napi::String>().Utf8Value();
  const std::string prefix = info[2].As<Napi::String>().Utf8Value();
  const int32_t requestedFrameCount = info[3].As<Napi::Number>().Int32Value();
  const int32_t requestedFrameWidth = info[4].As<Napi::Number>().Int32Value();

  NSURL* url = URLForSourceString(source);
  if (url == nil) {
    Napi::Error::New(env, "Invalid media source").ThrowAsJavaScriptException();
    return env.Null();
  }

  NSError* dirError = nil;
  NSString* outputDirectory = ToNSString(outputDir);
  if (![[NSFileManager defaultManager] createDirectoryAtPath:outputDirectory withIntermediateDirectories:YES attributes:nil error:&dirError]) {
    Napi::Error::New(env, dirError ? dirError.localizedDescription.UTF8String : "Failed to create filmstrip directory").ThrowAsJavaScriptException();
    return env.Null();
  }

  AVURLAsset* asset = [AVURLAsset URLAssetWithURL:url options:@{ AVURLAssetPreferPreciseDurationAndTimingKey: @NO }];
  const double duration = SafeAssetDurationSeconds(asset);
  const int32_t frameCount = std::max(2, std::min(24, requestedFrameCount));
  const int32_t frameWidth = std::max(96, std::min(240, requestedFrameWidth));

  AVAssetImageGenerator* generator = [[AVAssetImageGenerator alloc] initWithAsset:asset];
  generator.appliesPreferredTrackTransform = YES;
  generator.maximumSize = CGSizeMake(frameWidth, frameWidth);
  generator.requestedTimeToleranceBefore = kCMTimePositiveInfinity;
  generator.requestedTimeToleranceAfter = kCMTimePositiveInfinity;

  Napi::Array result = Napi::Array::New(env);
  uint32_t written = 0;
  for (int32_t i = 0; i < frameCount; i += 1) {
    const double normalized = (static_cast<double>(i) + 0.5) / static_cast<double>(frameCount);
    const double targetTime = ClampedPreviewTime(duration, normalized);
    NSError* imageError = nil;
    CGImageRef image = CopyPreviewFrame(generator, targetTime, &imageError);
    if (image == nil) continue;

    NSString* framePath = [outputDirectory stringByAppendingPathComponent:[NSString stringWithFormat:@"%s-%02d.jpg", prefix.c_str(), i]];
    NSError* writeError = nil;
    const bool wrote = WriteJpeg(image, framePath, kPreviewJpegQuality, &writeError);
    CGImageRelease(image);
    if (!wrote) continue;

    result.Set(written++, Napi::String::New(env, framePath.UTF8String));
  }

  return result;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("createSurface", Napi::Function::New(env, CreateSurface));
  exports.Set("destroySurface", Napi::Function::New(env, DestroySurface));
  exports.Set("setSurfaceRect", Napi::Function::New(env, SetSurfaceRect));
  exports.Set("setSurfaceHidden", Napi::Function::New(env, SetSurfaceHidden));
  exports.Set("clearSurface", Napi::Function::New(env, ClearSurface));
  exports.Set("syncSurface", Napi::Function::New(env, SyncSurface));
  exports.Set("generateThumbnail", Napi::Function::New(env, GenerateThumbnail));
  exports.Set("generateFilmstripFrames", Napi::Function::New(env, GenerateFilmstripFrames));
  return exports;
}

}  // namespace

NODE_API_MODULE(cinegen_avfoundation, Init)
