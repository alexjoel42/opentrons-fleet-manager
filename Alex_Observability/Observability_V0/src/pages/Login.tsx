import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, signup } from '../api/cloudApi';
import { useAuth } from '../lib/authContext';

export function Login() {
  const navigate = useNavigate();
  const { login: setToken, isCloudMode } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignup, setIsSignup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [pasteToken, setPasteToken] = useState('');
  const [showTokenPaste, setShowTokenPaste] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = isSignup ? await signup(email, password) : await login(email, password);
      setToken(res.access_token);
      setPassword('');
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setPending(false);
    }
  };

  const handlePasteToken = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const raw = pasteToken.trim();
    if (!raw) {
      setError('Paste your access token');
      return;
    }
    setToken(raw);
    setPasteToken('');
    navigate('/dashboard');
  };

  return (
    <div className="mx-auto max-w-sm rounded-2xl border border-border bg-card p-8 shadow-lg">
      <h1 className="font-display text-2xl font-normal tracking-tight text-foreground">
        {isSignup ? 'Create account' : 'Sign in'}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {isSignup ? 'Register to manage your labs and robots.' : 'Sign in to view your labs and robots.'}
      </p>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-foreground">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1 w-full rounded-xl border border-border bg-transparent px-4 py-2 text-foreground focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-foreground">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="mt-1 w-full rounded-xl border border-border bg-transparent px-4 py-2 text-foreground focus:ring-2 focus:ring-ring"
          />
        </div>
        {error && (
          <p className="text-sm text-error" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-xl bg-gradient-to-r from-accent to-accent-secondary py-2.5 font-medium text-accent-foreground disabled:opacity-70"
        >
          {pending ? 'Please wait…' : isSignup ? 'Sign up' : 'Sign in'}
        </button>
      </form>
      <button
        type="button"
        onClick={() => { setIsSignup((s) => !s); setError(null); }}
        className="mt-4 w-full text-sm text-muted-foreground hover:text-foreground"
      >
        {isSignup ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
      </button>

      {isCloudMode && (
        <div className="mt-8 border-t border-border pt-6">
          <button
            type="button"
            onClick={() => { setShowTokenPaste((v) => !v); setError(null); }}
            className="w-full text-left text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            {showTokenPaste ? 'Hide' : 'Already have an access token?'}
          </button>
          {showTokenPaste && (
            <form onSubmit={handlePasteToken} className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                Paste the JWT from a successful login API response (e.g. <code className="text-foreground">access_token</code> value).
              </p>
              <textarea
                id="paste-token"
                value={pasteToken}
                onChange={(e) => setPasteToken(e.target.value)}
                placeholder="eyJ…"
                rows={3}
                autoComplete="off"
                className="w-full rounded-xl border border-border bg-transparent px-3 py-2 font-mono text-xs text-foreground focus:ring-2 focus:ring-ring"
              />
              <button
                type="submit"
                className="w-full rounded-xl border border-border bg-muted/40 py-2 text-sm font-medium text-foreground hover:bg-muted/60"
              >
                Continue to dashboard
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
