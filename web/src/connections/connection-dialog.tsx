import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Dialog } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthStatus } from '../auth/auth-status';
import type { Credentials } from './api';

export type ConnectionAction =
  | { kind: 'connect'; id?: string; verify: boolean }
  | { kind: 'rename' | 'disconnect' | 'remove'; id: string };

interface Props {
  action: ConnectionAction;
  name: string;
  savedLabel?: string | null;
  error: string | null;
  pending: boolean;
  authorized: boolean;
  onClose(): void;
  onRestoreFocus(): void;
  onConnect(input: Credentials, label: string | null): Promise<'restart' | void>;
  onRename(label: string | null): Promise<void>;
  onConfirm(): Promise<void>;
  onRestart(): void;
}

export function ConnectionDialog({
  action, name, savedLabel, error, pending, authorized, onClose, onRestoreFocus,
  onConnect, onRename, onConfirm, onRestart,
}: Props) {
  const fieldId = useId();
  const [label, setLabel] = useState(savedLabel ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [submittedCredentials, setSubmittedCredentials] = useState(false);
  const [labelError, setLabelError] = useState(false);
  const otpInput = useRef<HTMLInputElement>(null);
  const verify = action.kind === 'connect' && action.verify;
  const showLabel = action.kind === 'rename' || (action.kind === 'connect' && !action.id);
  const showCredentials = action.kind === 'connect' && (!verify || !submittedCredentials);
  const pause = pending || !authorized;

  useEffect(() => {
    if (verify && submittedCredentials && !pause) otpInput.current?.focus();
  }, [pause, submittedCredentials, verify]);

  const text = action.kind === 'connect'
    ? verify
      ? ['Verify Wealthsimple sign-in', 'Enter your Wealthsimple verification code. If you did not receive a code, start over and check your email and password.', 'Verify and connect']
      : [action.id ? 'Connect to Wealthsimple' : 'Add Wealthsimple connection', 'Use your Wealthsimple sign-in details.', 'Connect']
    : action.kind === 'rename'
      ? ['Rename connection', 'Leave the name blank to use the provider name.', 'Save name']
      : action.kind === 'disconnect'
        ? ['Disconnect connection', `End the Wealthsimple session for “${name}”. You can reconnect using the saved record.`, 'Disconnect']
        : ['Remove saved connection', `Permanently remove “${name}” and clear any active session.`, 'Remove'];
  const [title, description, submitLabel] = text;
  const destructive = action.kind === 'disconnect' || action.kind === 'remove';

  function clearCredentials() {
    setPassword('');
    setOtp('');
    setSubmittedCredentials(false);
  }

  function restart() {
    clearCredentials();
    onRestart();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pause) return;
    const normalized = label.trim();
    if (showLabel && ([...normalized].length > 100 || normalized.includes('\0'))) {
      setLabelError(true);
      return;
    }
    if (action.kind === 'connect') {
      setOtp('');
      setSubmittedCredentials(true);
      void onConnect({ email: email.trim(), password, ...(verify ? { otp } : {}) }, normalized || null).then(result => {
        if (result === 'restart') clearCredentials();
      });
    } else if (action.kind === 'rename') {
      void onRename(normalized || null);
    } else {
      void onConfirm();
    }
  }

  return (
    <Dialog.Root open onOpenChange={open => { if (!open && !pending) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-1/2 overflow-y-auto rounded-xl border bg-card p-5 text-card-foreground shadow-lg sm:p-6"
          onEscapeKeyDown={event => { if (pending) event.preventDefault(); }}
          onPointerDownOutside={event => event.preventDefault()}
          onCloseAutoFocus={event => { event.preventDefault(); onRestoreFocus(); }}
        >
          <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="mt-1 mb-5 text-sm text-muted-foreground [overflow-wrap:anywhere]">{description}</Dialog.Description>
          <form className="space-y-4" onSubmit={submit}>
            {showLabel && (
              <div className="space-y-2">
                <Label htmlFor={`${fieldId}-label`}>Connection label{action.kind === 'connect' ? ' (optional)' : ''}</Label>
                <Input id={`${fieldId}-label`} value={label} placeholder="e.g. Personal" disabled={pause}
                  aria-invalid={labelError}
                  onChange={event => { setLabel(event.target.value); setLabelError(false); }} />
                {labelError && <p role="alert" className="text-sm text-destructive">Use a label of up to 100 characters.</p>}
              </div>
            )}
            {showCredentials && (
              <>
                <div className="space-y-2">
                  <Label htmlFor={`${fieldId}-email`}>Wealthsimple email</Label>
                  <Input id={`${fieldId}-email`} type="email" autoComplete="off" required maxLength={320}
                    value={email} disabled={pause} onChange={event => setEmail(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${fieldId}-password`}>Wealthsimple password</Label>
                  <Input id={`${fieldId}-password`} type="password" autoComplete="off" required maxLength={4096}
                    value={password} disabled={pause} onChange={event => setPassword(event.target.value)} />
                </div>
              </>
            )}
            {verify && (
              <div className="space-y-2">
                <Label htmlFor={`${fieldId}-otp`}>Verification code</Label>
                <Input ref={otpInput} id={`${fieldId}-otp`} inputMode="numeric" autoComplete="one-time-code"
                  pattern="[0-9]{1,32}" maxLength={32} required value={otp} disabled={pause}
                  onChange={event => setOtp(event.target.value)} />
              </div>
            )}
            {error && <AuthStatus message={error} error />}
            {!authorized && <AuthStatus message="Verifying your FinSight sign-in…" />}
            <div className="flex flex-wrap justify-end gap-2">
              {verify && <Button type="button" variant="ghost" disabled={pending} onClick={restart}>Start over</Button>}
              <Dialog.Close asChild><Button type="button" variant="outline" disabled={pending}>Cancel</Button></Dialog.Close>
              <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={pause}>
                {pending ? 'Please wait…' : submitLabel}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
