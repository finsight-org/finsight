import { Alert, AlertDescription } from '@/components/ui/alert';
export function AuthStatus({ message, error = false }: { message: string; error?: boolean }) {
  return <Alert role={error ? 'alert' : 'status'} variant={error ? 'destructive' : 'default'}><AlertDescription>{message}</AlertDescription></Alert>;
}
