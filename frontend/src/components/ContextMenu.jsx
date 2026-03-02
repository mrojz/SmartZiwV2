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
            className="context-menu"
            style={{
                position: 'fixed',
                top: `${top}px`,
                left: `${Math.max(8, left)}px`,
                zIndex: 9999,
            }}
        >
            {items.map((item, i) =>
                item.divider ? (
                    <div key={i} className="context-menu-divider" />
                ) : (
                    <button
                        key={i}
                        className={`context-menu-item ${item.danger ? 'danger' : ''} ${item.active ? 'active' : ''}`}
                        onClick={() => {
                            item.onClick();
                            onClose();
                        }}
                    >
                        <span className="context-menu-icon">{item.icon}</span>
                        <span>{item.label}</span>
                    </button>
                )
            )}
        </div>,
        document.body
    );
}

