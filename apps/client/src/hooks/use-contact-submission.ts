import { useEffect, useRef, useState } from 'react';

type SubmissionStatus = 'queued' | 'accepted' | 'delivered' | 'failed' | 'bounced' | 'unavailable';
interface ContactIntent {
  payload: string;
  id: string;
}
interface ContactResponse {
  status?: string;
  error?: string;
}
export function useContactSubmission() {
  const [status, setStatus] = useState<SubmissionStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const intent = useRef<ContactIntent | null>(null);
  const inFlight = useRef(false);
  const submit = async (payload: Record<string, string>) => {
    if (inFlight.current || status === 'queued') return;
    const fingerprint = JSON.stringify(payload);
    if (intent.current?.payload !== fingerprint || status === 'failed' || status === 'bounced')
      intent.current = { payload: fingerprint, id: crypto.randomUUID() };
    const id = intent.current.id;
    inFlight.current = true;
    setPending(true);
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify({ ...payload, requestId: id }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await response.json()) as ContactResponse;
      if (!response.ok) {
        setStatus('unavailable');
        setMessage(body.error ?? 'Your request has not been confirmed. Your input is still here.');
        return;
      }
      setRequestId(id);
      if (body.status === 'delivered') {
        setStatus('delivered');
        setMessage('The email provider reports delivery of your request.');
      } else if (body.status === 'accepted') {
        setStatus('accepted');
        setMessage(
          'Our email provider accepted your request. This does not guarantee inbox delivery.',
        );
      } else if (body.status === 'queued' || body.status === 'leased') {
        setStatus('queued');
        setMessage('Your request is queued. Delivery has not been confirmed yet.');
      } else {
        setStatus('failed');
        setMessage(
          'Delivery was not confirmed. Your input is still here. Retry or email tymabee@proton.me with your request reference.',
        );
      }
    } catch {
      setStatus('unavailable');
      setMessage(
        'Confirmation was interrupted. Your input is still here; retry to check the same request.',
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };
  useEffect(() => {
    if (!requestId || status !== 'queued') return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const check = async () => {
      if (!active) return;
      if (attempts++ >= 20) {
        setStatus('unavailable');
        setMessage(
          'Confirmation is taking longer than expected. Keep your request reference and contact tymabee@proton.me.',
        );
        return;
      }
      try {
        const response = await fetch(`/api/contact?requestId=${encodeURIComponent(requestId)}`, {
          cache: 'no-store',
          credentials: 'omit',
          signal: AbortSignal.timeout(8000),
        });
        const body = (await response.json()) as { status?: string };
        if (!active) return;
        if (response.ok && (body.status === 'accepted' || body.status === 'delivered')) {
          setStatus(body.status);
          setMessage(
            body.status === 'delivered'
              ? 'The email provider reports delivery of your request.'
              : 'Our email provider accepted your request. This does not guarantee inbox delivery.',
          );
          return;
        }
        if (response.ok && ['failed', 'bounced', 'obsolete'].includes(body.status ?? '')) {
          setStatus('failed');
          setMessage(
            'Delivery failed. Your input is still here. Retry or email tymabee@proton.me with your request reference.',
          );
          return;
        }
      } catch {
        /* - Retry status reads without resubmitting the message */
      }
      if (active) timer = setTimeout(() => void check(), 15_000);
    };
    timer = setTimeout(() => void check(), 3000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [requestId, status]);
  return { submit, pending, status, message, requestId };
}
