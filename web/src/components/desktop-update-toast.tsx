import { useEffect, useState } from 'react';
const ArrowUp = ({ size = 14 }: { size?: number }) => <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>;
import {
  desktopUpdateStatus,
  downloadDesktopUpdate,
  dismissDesktopUpdate,
  restartDesktopUpdate,
  retryDesktopUpdate,
  subscribeDesktopUpdateStatus,
  type DesktopUpdateStatus,
} from '../lib/desktopUpdate';

type BtnProps = { children: React.ReactNode; variant?: string; size?: string; asChild?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>;
function Button({ children, variant, size: _s, asChild, ...rest }: BtnProps) {
  const cls = `cfg-btn ${variant === 'ghost' ? 'cfg-btn--ghost' : variant === 'outline' || asChild ? 'cfg-btn--secondary' : 'cfg-btn--primary'}`;
  return asChild ? <span className={cls}>{children}</span> : <button className={cls} {...rest}>{children}</button>;
}

export function DesktopUpdateToast() {
  const [status, setStatus] = useState<DesktopUpdateStatus>();
  const [restarting, setRestarting] = useState(false);
  const [failed, setFailed] = useState<{ key: string; message: string }>();
  const failure = status?.failure?.dismissed ? undefined : status?.failure;
  const statusKey = `${failure?.id ?? ''}:${status?.readyVersion ?? ''}`;

  useEffect(() => {
    let received = false;
    const unsubscribe = subscribeDesktopUpdateStatus((value) => {
      received = true;
      setStatus(value);
    });
    void desktopUpdateStatus()
      ?.then((value) => {
        if (!received) setStatus(value);
      })
      .catch(() => {});
    return unsubscribe;
  }, []);

  const version = status?.readyVersion ?? '';
  if (!status || (!failure && (!version || version === status.dismissedVersion))) return null;
  const title = failure
    ? {
        checking: 'OpenKrishBot could not check for updates',
        preparing: 'OpenKrishBot could not prepare the update',
        downloading: 'OpenKrishBot could not download the update',
        restart: 'OpenKrishBot could not restart to update',
      }[failure.phase]
    : `OpenKrishBot ${version} is ready`;

  return (
    <aside className="desktop-update-toast" role="status" aria-label="OpenKrishBot update">
      <span className="desktop-update-toast-icon" aria-hidden="true">
        <ArrowUp size={14} />
      </span>
      <div className="desktop-update-toast-content">
        <strong>{title}</strong>
        {failure ? (
          <>
            <p role="alert">{failure.message}</p>
            <p>You can keep using OpenKrishBot.</p>
          </>
        ) : (
          <p>
            OpenKrishBot will update when you quit. You can also restart now.{' '}
            <a
              href={`https://github.com/DeepuExplainsAi/OpenKrishBot/releases/tag/v${encodeURIComponent(version)}`}
              target="_blank"
              rel="noreferrer"
            >
              Release notes
            </a>
          </p>
        )}
        {failed?.key === statusKey && <p role="alert">{failed.message}</p>}
        <div className="desktop-update-toast-actions">
          <Button
            type="button"
            size="sm"
            disabled={restarting || status.checking || (!failure && status.phase !== 'ready')}
            onClick={() => {
              setRestarting(true);
              setFailed(undefined);
              void (failure ? retryDesktopUpdate(failure.id) : restartDesktopUpdate())
                .catch((error) => setFailed({ key: statusKey, message: error.message }))
                .finally(() => setRestarting(false));
            }}
          >
            {restarting
              ? 'Please wait…'
              : failure
                ? failure.phase === 'restart'
                  ? 'Retry restart'
                  : 'Try again'
                : 'Restart to update'}
          </Button>
          {failure && (
            <Button asChild variant="outline" size="sm">
              <a
                href="https://github.com/DeepuExplainsAi/OpenKrishBot/releases/latest"
                target="_blank"
                rel="noreferrer"
                onClick={(event) => {
                  event.preventDefault();
                  void downloadDesktopUpdate().catch((error) =>
                    setFailed({ key: statusKey, message: error.message }),
                  );
                }}
              >
                Download OpenKrishBot
              </a>
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={restarting}
            onClick={() => {
              setFailed(undefined);
              void dismissDesktopUpdate(failure ? failure.id : version).catch((error) =>
                setFailed({ key: statusKey, message: error.message }),
              );
            }}
          >
            {failure ? 'Dismiss' : 'Later'}
          </Button>
        </div>
      </div>
    </aside>
  );
}
