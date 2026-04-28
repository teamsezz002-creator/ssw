import React, { useState } from 'react';
import { auth } from '../lib/firebase';
import { signInWithPopup, GoogleAuthProvider, GithubAuthProvider, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../components/ui/card';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { Github, Chrome } from 'lucide-react';

export default function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const navigate = useNavigate();

  const handleGoogleSignIn = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      toast.success('Signed in successfully');
      navigate('/');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleGithubSignIn = async () => {
    try {
      const provider = new GithubAuthProvider();
      // Request repo scope to list and fetch code
      provider.addScope('repo');
      const result = await signInWithPopup(auth, provider);
      const credential = GithubAuthProvider.credentialFromResult(result);
      const token = credential?.accessToken;
      
      if (token) {
        localStorage.setItem('gh_token', token);
      }
      
      toast.success('GitHub signed in successfully');
      navigate('/import');
    } catch (e: any) {
      if (e.code === 'auth/operation-not-allowed') {
        toast.error('GitHub provider is not enabled in Firebase Console. Please enable it and use this callback URL in your GitHub app settings: https://gen-lang-client-0945043157.firebaseapp.com/__/auth/handler', { duration: 10000 });
      } else if (e.code === 'auth/account-exists-with-different-credential') {
        toast.error('This email is already linked to Google login. Please sign in with Google first, then you can connect GitHub from the Import page.', { duration: 8000 });
      } else {
        toast.error(e.message);
      }
      console.error('Auth error:', e);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
      toast.success('Authenticated successfully');
      navigate('/');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-8rem)]">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">{isLogin ? 'Login' : 'Create Account'}</CardTitle>
          <CardDescription>
            Enter your credentials to access the learning portal
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleEmailAuth} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input 
                type="email" 
                placeholder="name@example.com" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Password</label>
              <Input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full">
              {isLogin ? 'Login' : 'Sign Up'}
            </Button>
          </form>
          
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-neutral-500">Or continue with</span>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <Button variant="outline" className="w-full" onClick={handleGoogleSignIn}>
              <Chrome className="mr-2 h-4 w-4" /> Google
            </Button>
            <Button variant="outline" className="w-full" onClick={handleGithubSignIn}>
              <Github className="mr-2 h-4 w-4" /> GitHub
            </Button>
          </div>
        </CardContent>
        <CardFooter className="justify-center">
          <Button variant="link" onClick={() => setIsLogin(!isLogin)}>
            {isLogin ? "Don't have an account? Sign up" : "Already have an account? Login"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
