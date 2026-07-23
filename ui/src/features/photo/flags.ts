// Photo/OCR board capture is gated off in production, on in dev/tests (VITE_ENABLE_OCR=1).
// Both the desktop PhotoSetup and the mobile camera flow read this single source so they
// expose the camera entry point together.
export const OCR_ENABLED =
  import.meta.env.VITE_ENABLE_OCR === '1' || import.meta.env.VITE_ENABLE_OCR === 'true';
