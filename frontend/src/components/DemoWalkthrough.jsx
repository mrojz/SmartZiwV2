import { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const CARD_GAP = 12;
const CARD_EDGE = 8;

function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return true;
}

export default function DemoWalkthrough({ open, onClose, steps = [] }) {
    const [step, setStep] = useState(0);
    const [rect, setRect] = useState(null);       // viewport rect of the current target, or null
    const [cardPos, setCardPos] = useState(null); // { top, left } of the tooltip card
    const cardRef = useRef(null);
    const rafRef = useRef(null);

    const total = steps.length;
    const safeStep = Math.min(step, Math.max(0, total - 1));
    const current = total > 0 ? steps[safeStep] : null;
    const target = current ? current.target : null;
    const isLast = safeStep === total - 1;

    // Reset to the first step every time the walkthrough opens.
    useEffect(() => {
        if (open) setStep(0);
    }, [open]);

    // Measure the target rect; recompute on resize and on scroll (rAF-throttled).
    useEffect(() => {
        if (!open) return;
        const measure = () => {
            if (!target) {
                setRect(null);
                return;
            }
            const el = document.querySelector(target);
            if (isVisible(el)) {
                const r = el.getBoundingClientRect();
                setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
            } else {
                setRect(null);
            }
        };
        measure();
        const onScroll = () => {
            if (rafRef.current) return;
            rafRef.current = requestAnimationFrame(() => {
                rafRef.current = null;
                measure();
            });
        };
        window.addEventListener('resize', measure);
        window.addEventListener('scroll', onScroll, true);
        return () => {
            window.removeEventListener('resize', measure);
            window.removeEventListener('scroll', onScroll, true);
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
        };
    }, [open, target]);

    // Scroll the target into view once the overlay is mounted (and per step).
    useEffect(() => {
        if (!open || !target) return;
        const el = document.querySelector(target);
        if (!el) return;
        const timer = setTimeout(() => {
            try {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } catch (err) {
                // Older browsers may not support scrollIntoView options; ignore.
            }
        }, 60);
        return () => clearTimeout(timer);
    }, [open, target]);

    // Position the tooltip card near the target: below if it fits, else above,
    // clamped to stay inside the viewport.
    useEffect(() => {
        if (!open) return;
        if (!rect) {
            setCardPos(null);
            return;
        }
        const card = cardRef.current;
        if (!card) return;
        const cw = card.offsetWidth;
        const ch = card.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let top = rect.top + rect.height + CARD_GAP;
        if (top + ch > vh - CARD_EDGE) {
            top = rect.top - CARD_GAP - ch;
        }
        top = Math.min(Math.max(CARD_EDGE, top), Math.max(CARD_EDGE, vh - ch - CARD_EDGE));
        let left = rect.left + rect.width / 2 - cw / 2;
        left = Math.min(Math.max(CARD_EDGE, left), Math.max(CARD_EDGE, vw - cw - CARD_EDGE));
        setCardPos({ top, left });
    }, [open, rect, step]);

    // Escape to dismiss + lock body scroll while open; restore on close/unmount.
    useEffect(() => {
        if (!open) return;
        const onKey = (e) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [open, onClose]);

    if (!open || !current) return null;

    const cardContent = (
        <>
            <p className="mb-1.5 text-xs font-bold tracking-widest text-amber-600 uppercase">Step {safeStep + 1} of {total}</p>
            <h3 className="mb-1.5 text-lg leading-snug font-bold text-foreground">{current.title}</h3>
            <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{current.body}</p>
            <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" className="mr-auto text-muted-foreground" onClick={onClose}>
                    Skip
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={safeStep === 0}
                    onClick={() => setStep((s) => Math.max(0, s - 1))}
                >
                    Back
                </Button>
                <Button
                    type="button"
                    size="sm"
                    className="bg-amber-600 text-white hover:bg-amber-700"
                    onClick={() => (isLast ? onClose() : setStep((s) => Math.min(total - 1, s + 1)))}
                >
                    {isLast ? 'Finish' : 'Next'}
                </Button>
            </div>
        </>
    );

    return (
        <div className="fixed inset-0 z-[9999]" onClick={onClose}>
            {rect ? (
                <>
                    <div
                        className="fixed rounded-xl shadow-[0_0_0_3px_var(--color-amber-600),0_0_0_9999px_rgba(2,6,23,0.55)]"
                        style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
                        onClick={(e) => e.stopPropagation()}
                    />
                    <Card
                        ref={cardRef}
                        className="fixed z-[1] w-[340px] max-w-[calc(100vw-24px)] border-slate-200 bg-white p-4 shadow-2xl"
                        style={cardPos ? { top: cardPos.top, left: cardPos.left } : { visibility: 'hidden' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <CardContent className="p-0">{cardContent}</CardContent>
                    </Card>
                </>
            ) : (
                <Card
                    className="fixed z-[1] w-[340px] max-w-[calc(100vw-24px)] border-slate-200 bg-white p-4 shadow-2xl"
                    style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <CardContent className="p-0">{cardContent}</CardContent>
                </Card>
            )}
        </div>
    );
}
