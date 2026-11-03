import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
export function AuthForm({ pending, onSubmit, mode = 'sign-in' }: { pending: boolean; mode?: 'sign-in' | 'sign-up'; onSubmit(email: string, password: string): Promise<void> }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void onSubmit(email.trim(), password); };
  return <form onSubmit={submit} className="space-y-5">
    <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} disabled={pending} /></div>
    <div className="space-y-2"><Label htmlFor="password">Password</Label><Input id="password" type="password" autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'} minLength={mode === 'sign-up' ? 8 : undefined} required value={password} onChange={e => setPassword(e.target.value)} disabled={pending} />{mode === 'sign-up' && <p className="text-xs text-muted-foreground">Use at least 8 characters.</p>}</div>
    <Button type="submit" className="w-full" disabled={pending}>{pending ? 'Please wait…' : mode === 'sign-up' ? 'Create account' : 'Sign in'}</Button>
  </form>;
}
