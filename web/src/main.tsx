import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthStatus } from './auth/auth-status';
import { readWebConfig } from './config';
import { createBrowserAuthClient } from './lib/supabase';
import './index.css';
const root = createRoot(document.getElementById('root')!);
try {
  const config = readWebConfig({
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    VITE_FINSIGHT_API_URL: import.meta.env.VITE_FINSIGHT_API_URL,
  });
  root.render(<App client={createBrowserAuthClient(config)} apiUrl={config.apiUrl} />);
} catch {
  root.render(<main className="mx-auto max-w-md p-8"><AuthStatus error message="Complete the public frontend configuration in web/.env, then restart or rebuild the application." /></main>);
}
