/** Centralised modal body-scroll lock with reference counting. */
export function setModalScrollLock(locked) {
    if (typeof document === 'undefined') return;
    const body = document.body;
    const html = document.documentElement;
    const current = Number(body.dataset.modalLockCount || '0');
    const next = locked ? current + 1 : Math.max(0, current - 1);
    body.dataset.modalLockCount = String(next);
    const shouldLock = next > 0;
    body.classList.toggle('modal-scroll-locked', shouldLock);
    html.classList.toggle('modal-scroll-locked', shouldLock);
}
