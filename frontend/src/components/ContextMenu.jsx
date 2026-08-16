import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function ContextMenu({ anchorRect, items, onClose }) {
    const menuRef = useRef(null);

    useEffect(() => {
        const handleClick = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                onClose();
            }
        };
        const handleKey = (e) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('mousedown', handleClick);
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('keydown', handleKey);
        };
    }, [onClose]);

    if (!anchorRect) return null;

    // Position menu below the anchor, flip if near bottom
    const top = anchorRect.bottom + 4;
    const left = anchorRect.right - 180; // align right edge

    return createPortal(
        <div
            ref={menuRef}
            className="context-menu min-w-[190px] rounded-[14px] border border-blue-500/[0.08] bg-white/95 p-1.5 shadow-[0_16px_48px_rgba(13,27,50,0.14),0_0_0_1px_rgba(31,123,246,0.04)] backdrop-blur-[20px] backdrop-saturate-[1.8]"
            style={{
                position: 'fixed',
                top: `${top}px`,
                left: `${Math.max(8, left)}px`,
                zIndex: 9999,
            }}
        >
            {items.map((item, i) =>
                item.divider ? (
                    <div key={i} className="mx-2 my-1 h-px bg-[#e4edf9]" />
                ) : (
                    <button
                        key={i}
                        className={`context-menu-item flex w-full cursor-pointer items-center gap-3 rounded-lg border-none bg-none px-3 py-2 font-sans text-left text-[0.9rem] font-semibold text-[#334762] transition-colors duration-150 hover:bg-[#eef3fa] hover:text-[#0d1b32] ${item.danger ? 'hover:bg-[#fef0f3] hover:text-[#c7384f]' : ''} ${item.active ? 'text-[#0f8f63]' : ''}`}
                        onClick={() => {
                            item.onClick();
                            onClose();
                        }}
                    >
                        <span className="h-5 w-5 shrink-0 rounded-full border border-[#e4edf9] bg-[#eef3fa] text-center text-[0.8rem] leading-[18px]">{item.icon}</span>
                        <span>{item.label}</span>
                    </button>
                )
            )}
        </div>,
        document.body
    );
}

