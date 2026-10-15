import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

export function useTurnAlert(draftId: string | undefined, pick: number, myTurn: boolean) {
  const [enabled, setEnabled] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const played = useRef(new Set<string>());
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => listener.remove();
  }, []);
  const play = useCallback(() => {
    if (Platform.OS !== 'web' || !draftId || !myTurn) return;
    const key = 'brock-turn:' + draftId + ':' + pick;
    if (played.current.has(key)) return;
    try {
      if (sessionStorage.getItem(key)) return;
    } catch {
      /* Storage is optional. */
    }
    audio.current ??= new Audio('/draft-audio/On_The_Clock.mp3');
    audio.current.currentTime = 0;
    played.current.add(key);
    void audio.current
      .play()
      .then(() => {
        setMessage(null);
        try {
          sessionStorage.setItem(key, 'played');
        } catch {
          /* Storage is optional. */
        }
      })
      .catch(() => {
        played.current.delete(key);
        setEnabled(false);
        setMessage('Tap Enable turn sound to allow audio in this browser.');
      });
  }, [draftId, myTurn, pick]);
  useEffect(() => {
    if (!myTurn || !enabled) {
      audio.current?.pause();
      return;
    }
    play();
    return () => {
      audio.current?.pause();
    };
    // Each overall pick is a separate turn, including adjacent snake picks.
  }, [enabled, myTurn, play]);
  return {
    enabled,
    reducedMotion,
    message,
    toggle: () => {
      if (enabled) {
        audio.current?.pause();
        setEnabled(false);
      } else {
        if (Platform.OS !== 'web') {
          setMessage('Turn sound is available in the web app.');
          return;
        }
        audio.current ??= new Audio('/draft-audio/On_The_Clock.mp3');
        if (myTurn) {
          setEnabled(true);
          play();
          return;
        }
        // Activate this audio element during the click for browsers that require
        // a gesture on the element itself, then silence it until an own turn.
        const element = audio.current;
        element.muted = true;
        void element
          .play()
          .then(() => {
            element.pause();
            element.currentTime = 0;
            element.muted = false;
            setMessage(null);
            setEnabled(true);
          })
          .catch(() => {
            element.muted = false;
            setEnabled(false);
            setMessage('Audio could not start. Tap Enable turn sound to try again.');
          });
      }
    },
  };
}
