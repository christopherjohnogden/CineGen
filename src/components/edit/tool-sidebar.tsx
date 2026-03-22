import type { ToolType } from '@/types/timeline';
import clickSvg from '@/assets/click.svg';
import razorBladeSvg from '@/assets/razor-blade.svg';
import bleedLinesSvg from '@/assets/bleed-lines.svg';

import fillGapSvg from '@/assets/fill gap.svg';
import extendSvg from '@/assets/extend.svg';
import maskSvg from '@/assets/mask.svg';

interface ToolDef {
  id: ToolType;
  label: string;
  shortcut: string;
  icon: React.ReactNode;
  group: 'primary' | 'trim' | 'generate';
}

/* SVG icon helpers — matching LTX's lucide-style icons */
const Icon = ({ children }: { children: React.ReactNode }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const SelectIcon = () => <img src={clickSvg} alt="Select" width="18" height="18" className="tool-sidebar__img-icon" style={{ transform: 'scale(0.95)' }} />;

const BladeIcon = () => <img src={razorBladeSvg} alt="Blade" width="18" height="18" className="tool-sidebar__img-icon" style={{ transform: 'rotate(90deg) scale(0.95)' }} />;
const RippleIcon = () => <img src={bleedLinesSvg} alt="Ripple" width="18" height="18" className="tool-sidebar__img-icon" />;
const RollIcon = () => <Icon><path d="M8 3H5a2 2 0 00-2 2v14a2 2 0 002 2h3" /><path d="M16 3h3a2 2 0 012 2v14a2 2 0 01-2 2h-3" /><line x1="12" y1="3" x2="12" y2="21" /></Icon>;
const SlipIcon = () => <Icon><rect x="3" y="6" width="18" height="12" rx="1" /><path d="M8 6v12" /><path d="M16 6v12" /></Icon>;
const SlideIcon = () => <Icon><path d="M5 9l-3 3 3 3" /><path d="M19 9l3 3-3 3" /><rect x="6" y="8" width="12" height="8" rx="1" /></Icon>;
const MusicIcon = () => <Icon><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></Icon>;
const FillGapIcon = () => <img src={fillGapSvg} alt="Fill Gap" width="18" height="18" className="tool-sidebar__img-icon" />;
const ExtendIcon = () => <img src={extendSvg} alt="Extend" width="18" height="18" className="tool-sidebar__img-icon" />;
const MaskIcon = () => <img src={maskSvg} alt="Mask" width="18" height="18" className="tool-sidebar__img-icon" />;

const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Selection Tool', shortcut: 'V', icon: <SelectIcon />, group: 'primary' },

  { id: 'blade', label: 'Blade Tool', shortcut: 'B', icon: <BladeIcon />, group: 'primary' },
  { id: 'ripple', label: 'Ripple Trim', shortcut: 'R', icon: <RippleIcon />, group: 'trim' },
  { id: 'roll', label: 'Roll Trim', shortcut: 'N', icon: <RollIcon />, group: 'trim' },
  { id: 'slip', label: 'Slip', shortcut: 'Y', icon: <SlipIcon />, group: 'trim' },
  { id: 'slide', label: 'Slide', shortcut: 'U', icon: <SlideIcon />, group: 'trim' },
  { id: 'music', label: 'Music Tool', shortcut: 'M', icon: <MusicIcon />, group: 'generate' },
  { id: 'fillGap', label: 'Fill Gap Tool', shortcut: '', icon: <FillGapIcon />, group: 'generate' },
  { id: 'extend', label: 'Extend Tool', shortcut: 'E', icon: <ExtendIcon />, group: 'generate' },
  { id: 'mask', label: 'Mask Tool', shortcut: 'X', icon: <MaskIcon />, group: 'generate' },
];

interface ToolSidebarProps {
  activeTool: ToolType;
  onToolChange: (tool: ToolType) => void;
}

export function ToolSidebar({ activeTool, onToolChange }: ToolSidebarProps) {
  const primaryTools = TOOLS.filter((t) => t.group === 'primary');
  const trimTools = TOOLS.filter((t) => t.group === 'trim');
  const generateTools = TOOLS.filter((t) => t.group === 'generate');

  return (
    <div className="tool-sidebar">
      {primaryTools.map((tool) => (
        <button
          key={tool.id}
          className={`tool-sidebar__btn ${tool.id === activeTool ? 'tool-sidebar__btn--active' : ''}`}
          onClick={() => onToolChange(tool.id)}
          title={`${tool.label}${tool.shortcut ? ` (${tool.shortcut})` : ''}`}
        >
          {tool.icon}
        </button>
      ))}
      <div className="tool-sidebar__separator" />
      {trimTools.map((tool) => (
        <button
          key={tool.id}
          className={`tool-sidebar__btn ${tool.id === activeTool ? 'tool-sidebar__btn--active' : ''}`}
          onClick={() => onToolChange(tool.id)}
          title={`${tool.label}${tool.shortcut ? ` (${tool.shortcut})` : ''}`}
        >
          {tool.icon}
        </button>
      ))}
      <div className="tool-sidebar__separator" />
      {generateTools.map((tool) => (
        <button
          key={tool.id}
          className={`tool-sidebar__btn ${tool.id === activeTool ? 'tool-sidebar__btn--active' : ''}`}
          onClick={() => onToolChange(tool.id)}
          title={`${tool.label}${tool.shortcut ? ` (${tool.shortcut})` : ''}`}
        >
          {tool.icon}
        </button>
      ))}
    </div>
  );
}
