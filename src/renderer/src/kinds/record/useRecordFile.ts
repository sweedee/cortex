/** Reads a text file and keeps it live: `fs:watch` on its folder, reload on `fs:changed`. Re-mount (key) per path. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { native } from '../../native';
import { errorText } from '../../ui/task';
import { dirOf, isAbsolutePath, normPath } from './model';

export interface RecordFile {
  /** undefined until the first read finished */
  text: string | undefined;
  error: string | undefined;
  loading: boolean;
  reload: () => void;
  /** write the file; the new text is shown right away */
  save: (text: string) => Promise<void>;
}

export function useRecordFile(path: string | undefined): RecordFile {
  const real = isAbsolutePath(path) ? path : undefined;
  const [text, setText] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(!!real);
  const seq = useRef(0);

  const read = useCallback(async () => {
    if (!real) return;
    const mine = ++seq.current;
    try {
      const t = await native.fs.readText(real);
      if (mine === seq.current) {
        setText(t);
        setError(undefined);
      }
    } catch (e) {
      if (mine === seq.current) {
        setText(undefined);
        setError(errorText(e));
      }
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [real]);

  useEffect(() => {
    if (!real) return;
    void read(); // oxlint-disable-line react/set-state-in-effect -- initial fetch of an external file
    let watchId: string | undefined;
    let gone = false;
    const target = normPath(real);
    const off = native.fs.onChanged((e) => {
      if (e.watchId !== watchId) return;
      if (e.path === null || normPath(e.path) === target) void read();
    });
    native.fs
      .watch(dirOf(real))
      .then((id) => {
        if (gone) void native.fs.unwatch(id).catch(() => {});
        else watchId = id;
      })
      .catch(() => {
        /* folder missing: the read error says so */
      });
    return () => {
      gone = true;
      off();
      if (watchId) void native.fs.unwatch(watchId).catch(() => {});
    };
  }, [real, read]);

  const save = useCallback(
    async (next: string) => {
      if (!real) throw new Error('No file on disk');
      await native.fs.writeText(real, next);
      seq.current++;
      setText(next);
      setError(undefined);
    },
    [real],
  );

  return { text, error, loading, reload: () => void read(), save };
}
