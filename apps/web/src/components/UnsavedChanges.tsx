import { useEffect, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { Button, Dialog } from './ui';

export function useUnsavedChanges(dirty: boolean, saving = false) {
  const [closeAction, setCloseAction] = useState<(() => void) | null>(null);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      (dirty || saving) &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  );
  useEffect(() => {
    if (!dirty && !saving) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, saving]);
  function keepEditing() {
    setCloseAction(null);
    if (blocker.state === 'blocked') blocker.reset();
  }
  return {
    confirmClose: (action: () => void) => {
      if (dirty || saving) setCloseAction(() => action);
      else action();
    },
    guard: (blocker.state === 'blocked' || closeAction) && (
      <Dialog title={saving ? 'Changes are being saved' : 'Unsaved changes'} onClose={keepEditing}>
        <p>
          {saving
            ? 'Please wait for saving to finish before leaving.'
            : 'Leaving now will discard your edits. Keep editing or discard your changes.'}
        </p>
        <div className="form-actions">
          <Button type="button" variant="outline" onClick={keepEditing}>
            Keep editing
          </Button>
          {!saving && (
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                if (closeAction) closeAction();
                else if (blocker.state === 'blocked') blocker.proceed();
                setCloseAction(null);
              }}
            >
              Discard changes
            </Button>
          )}
        </div>
      </Dialog>
    ),
  };
}
