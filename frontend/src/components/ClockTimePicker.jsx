import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Mobile-style analog clock time picker (24h only).
 * Step 1: pick hour on a two-ring dial (inner 0-11, outer 12-23).
 * Step 2: auto-advance to minutes (5-min ticks labeled).
 * Editable HH:mm inputs above the clock.
 */
export default function ClockTimePicker({ hour: initHour, minute: initMinute, onConfirm, onCancel }) {
    const [hour, setHour] = useState(initHour ?? 0);
    const [minute, setMinute] = useState(initMinute ?? 0);
    const [mode, setMode] = useState('hour'); // 'hour' | 'minute'
    const [editingH, setEditingH] = useState(null);
    const [editingM, setEditingM] = useState(null);
    const clockRef = useRef(null);
    const dragging = useRef(false);

    // ── Geometry ──
    const SIZE = 260;
    const CX = SIZE / 2;
    const CY = SIZE / 2;
    const OUTER_R = 105;
    const INNER_R = 72;
    const MINUTE_R = 105;
    const DOT_R = 18;

    // Build positions
    const hourPositions = [];
    // Outer ring: 12-23
    for (let i = 0; i < 12; i++) {
        const angle = (i - 3) * 30 * (Math.PI / 180);
        hourPositions.push({
            value: i + 12,
            x: CX + OUTER_R * Math.cos(angle),
            y: CY + OUTER_R * Math.sin(angle),
            ring: 'outer',
        });
    }
    // Inner ring: 0-11
    for (let i = 0; i < 12; i++) {
        const angle = (i - 3) * 30 * (Math.PI / 180);
        hourPositions.push({
            value: i,
            x: CX + INNER_R * Math.cos(angle),
            y: CY + INNER_R * Math.sin(angle),
            ring: 'inner',
        });
    }

    const minutePositions = [];
    for (let i = 0; i < 60; i += 5) {
        const angle = (i / 5 - 3) * 30 * (Math.PI / 180);
        minutePositions.push({
            value: i,
            x: CX + MINUTE_R * Math.cos(angle),
            y: CY + MINUTE_R * Math.sin(angle),
        });
    }

    // ── Pointer from click/touch ──
    const resolveFromPointer = useCallback((clientX, clientY) => {
        const rect = clockRef.current.getBoundingClientRect();
        const x = clientX - rect.left - CX;
        const y = clientY - rect.top - CY;
        let angle = Math.atan2(y, x) * (180 / Math.PI) + 90;
        if (angle < 0) angle += 360;
        const dist = Math.sqrt(x * x + y * y);

        if (mode === 'hour') {
            const step = Math.round(angle / 30) % 12;
            if (dist < (OUTER_R + INNER_R) / 2) {
                // Inner ring: 0-11
                setHour(step);
            } else {
                // Outer ring: 12-23
                setHour(step + 12);
            }
        } else {
            const step = Math.round(angle / 6) % 60;
            setMinute(step);
        }
    }, [mode]);

    const onPointerDown = useCallback((e) => {
        dragging.current = true;
        const touch = e.touches ? e.touches[0] : e;
        resolveFromPointer(touch.clientX, touch.clientY);
    }, [resolveFromPointer]);

    const onPointerMove = useCallback((e) => {
        if (!dragging.current) return;
        e.preventDefault();
        const touch = e.touches ? e.touches[0] : e;
        resolveFromPointer(touch.clientX, touch.clientY);
    }, [resolveFromPointer]);

    const onPointerUp = useCallback(() => {
        if (!dragging.current) return;
        dragging.current = false;
        if (mode === 'hour') {
            setMode('minute');
        }
    }, [mode]);

    useEffect(() => {
        const handleUp = () => { dragging.current = false; };
        window.addEventListener('mouseup', handleUp);
        window.addEventListener('touchend', handleUp);
        return () => {
            window.removeEventListener('mouseup', handleUp);
            window.removeEventListener('touchend', handleUp);
        };
    }, []);

    // ── Editable inputs ──
    const commitH = (raw) => {
        const v = parseInt(raw, 10);
        if (!isNaN(v)) setHour(Math.max(0, Math.min(23, v)));
        setEditingH(null);
    };

    const commitM = (raw) => {
        const v = parseInt(raw, 10);
        if (!isNaN(v)) setMinute(Math.max(0, Math.min(59, v)));
        setEditingM(null);
    };

    // ── Hand line geometry ──
    const selectedAngle = mode === 'hour'
        ? ((hour % 12) - 3) * 30 * (Math.PI / 180)
        : (minute / 5 - 3) * 30 * (Math.PI / 180);
    const handR = mode === 'hour'
        ? (hour < 12 ? INNER_R : OUTER_R)
        : MINUTE_R;
    const handX = CX + handR * Math.cos(selectedAngle);
    const handY = CY + handR * Math.sin(selectedAngle);

    const pad = (n) => String(n).padStart(2, '0');

    return (
        <div className="ctp-overlay" onClick={onCancel}>
            <div className="ctp-modal" onClick={(e) => e.stopPropagation()}>
                {/* HH:mm editable header */}
                <div className="ctp-header">
                    <input
                        className={`ctp-input ${mode === 'hour' ? 'active' : ''}`}
                        name="clockHour"
                        aria-label="Hour"
                        value={editingH !== null ? editingH : pad(hour)}
                        onFocus={() => { setEditingH(pad(hour)); setMode('hour'); }}
                        onChange={(e) => setEditingH(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
                        onBlur={(e) => commitH(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') commitH(e.target.value); }}
                        maxLength={2}
                        inputMode="numeric"
                    />
                    <span className="ctp-colon">:</span>
                    <input
                        className={`ctp-input ${mode === 'minute' ? 'active' : ''}`}
                        name="clockMinute"
                        aria-label="Minute"
                        value={editingM !== null ? editingM : pad(minute)}
                        onFocus={() => { setEditingM(pad(minute)); setMode('minute'); }}
                        onChange={(e) => setEditingM(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
                        onBlur={(e) => commitM(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') commitM(e.target.value); }}
                        maxLength={2}
                        inputMode="numeric"
                    />
                </div>

                <div className="ctp-mode-label">
                    {mode === 'hour' ? 'Select hour' : 'Select minute'}
                </div>

                {/* Clock face */}
                <div
                    className="ctp-clock"
                    ref={clockRef}
                    style={{ width: SIZE, height: SIZE }}
                    onMouseDown={onPointerDown}
                    onMouseMove={onPointerMove}
                    onMouseUp={onPointerUp}
                    onTouchStart={onPointerDown}
                    onTouchMove={onPointerMove}
                    onTouchEnd={onPointerUp}
                >
                    <svg width={SIZE} height={SIZE} className="ctp-svg">
                        {/* Clock background */}
                        <circle cx={CX} cy={CY} r={CX - 2} className="ctp-face" />

                        {/* Center dot */}
                        <circle cx={CX} cy={CY} r={4} className="ctp-center-dot" />

                        {/* Hand line */}
                        <line x1={CX} y1={CY} x2={handX} y2={handY} className="ctp-hand" />

                        {/* Selected dot */}
                        <circle cx={handX} cy={handY} r={DOT_R} className="ctp-selected-dot" />

                        {/* Numbers */}
                        {mode === 'hour' ? (
                            hourPositions.map((hp) => (
                                <text
                                    key={hp.value}
                                    x={hp.x}
                                    y={hp.y}
                                    className={`ctp-num ${hp.ring === 'inner' ? 'ctp-num-inner' : ''} ${hp.value === hour ? 'ctp-num-selected' : ''}`}
                                    dominantBaseline="central"
                                    textAnchor="middle"
                                >
                                    {hp.value}
                                </text>
                            ))
                        ) : (
                            minutePositions.map((mp) => (
                                <text
                                    key={mp.value}
                                    x={mp.x}
                                    y={mp.y}
                                    className={`ctp-num ${mp.value === minute ? 'ctp-num-selected' : ''}`}
                                    dominantBaseline="central"
                                    textAnchor="middle"
                                >
                                    {pad(mp.value)}
                                </text>
                            ))
                        )}
                    </svg>
                </div>

                {/* Actions */}
                <div className="ctp-actions">
                    <button type="button" className="ctp-btn ctp-cancel" onClick={onCancel}>Cancel</button>
                    <button type="button" className="ctp-btn ctp-confirm" onClick={() => onConfirm(hour, minute)}>
                        Confirm {pad(hour)}:{pad(minute)}
                    </button>
                </div>
            </div>
        </div>
    );
}

