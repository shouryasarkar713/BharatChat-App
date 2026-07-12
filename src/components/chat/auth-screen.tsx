'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, MessageSquare, Sparkles, Lock, Zap, Shield } from 'lucide-react'
import { toast } from 'sonner'

export function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [loading, setLoading] = useState(false)
  const [loginForm, setLoginForm] = useState({ email: 'alice@chat.dev', password: 'password123' })
  const [registerForm, setRegisterForm] = useState({
    name: '',
    username: '',
    email: '',
    password: '',
  })

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const res = await signIn('credentials', {
      email: loginForm.email,
      password: loginForm.password,
      redirect: false,
    })
    setLoading(false)
    if (!res?.ok) {
      toast.error('Login failed', { description: 'Check your credentials' })
    } else {
      toast.success('Welcome back!')
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registerForm),
      })
      const data = await res.json()
      if (!res.ok) {
        let desc = data.error || 'Try again'
        if (data.details?.fieldErrors) {
          const errors = Object.entries(data.details.fieldErrors)
            .map(([field, msgs]: [string, any]) => `${field}: ${msgs.join(', ')}`)
            .join('; ')
          if (errors) desc = errors
        }
        toast.error('Registration failed', { description: desc })
      } else {
        await fetch('/api/auth/seed', { method: 'POST' }).catch(() => {})
        await signIn('credentials', {
          email: registerForm.email,
          password: registerForm.password,
          redirect: false,
        })
        toast.success('Account created!')
      }
    } catch (e) {
      toast.error('Registration failed')
    }
    setLoading(false)
  }

  async function handleSeedAndLogin() {
    setLoading(true)
    toast.info('Seeding demo accounts...')
    try {
      const res = await fetch('/api/auth/seed', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        toast.error('Seeding failed', { description: data.error || 'Check server logs' })
      } else {
        toast.success('Demo accounts ready! alice@chat.dev / password123')
      }
    } catch (e) {
      toast.error('Seeding failed', { description: 'Connection error' })
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background bg-mesh p-4 relative overflow-hidden">
      {/* Decorative jaali pattern circles — replace generic gradient orbs */}
      <div className="absolute top-1/4 left-1/4 h-96 w-96 jaali-circle pointer-events-none" aria-hidden="true" />
      <div className="absolute bottom-1/4 right-1/4 h-80 w-80 jaali-circle pointer-events-none" aria-hidden="true" />

      <div className="w-full max-w-md relative z-10">
        <div className="flex flex-col items-center mb-8">
          <div className="h-16 w-16 rounded-2xl bg-primary flex items-center justify-center shadow-lg shadow-primary/20 mb-4 transform hover:scale-105 transition-transform duration-200">
            <MessageSquare className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight text-foreground pb-1">BharatChat</h1>
          <p className="text-sm text-muted-foreground mt-1.5 font-medium tracking-wide">Real-time end-to-end encrypted chat</p>
        </div>

        {/* Feature badges — teal icon tints, warm surfaces */}
        <div className="grid grid-cols-3 gap-2.5 mb-6">
          {[
            { icon: Lock, label: 'E2E encrypted' },
            { icon: Zap, label: 'Real-time' },
            { icon: Shield, label: 'Moderated' },
          ].map((f) => (
            <div
              key={f.label}
              className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-card/40 backdrop-blur-md border border-border/40 hover:border-accent-foreground/20 transition-all hover:translate-y-[-2px] duration-200"
            >
              <f.icon className="h-4.5 w-4.5 text-accent-foreground" />
              <span className="text-[10px] font-semibold text-muted-foreground text-center tracking-wide">{f.label}</span>
            </div>
          ))}
        </div>

        <Card className="border-border/30 bg-card/60 backdrop-blur-xl shadow-lift overflow-hidden border">
          <div className="absolute top-0 left-0 w-full h-[3px] bg-primary" />
          <CardHeader className="pb-4">
            <CardTitle className="text-2xl font-bold text-foreground">Welcome back</CardTitle>
            <CardDescription className="text-muted-foreground/80">
              Sign in to start messaging, or create a new account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
              <TabsList className="grid w-full grid-cols-2 mb-5 p-1 bg-muted/60 rounded-xl">
                <TabsTrigger value="login" className="rounded-lg font-semibold py-1.5 transition-all">Sign in</TabsTrigger>
                <TabsTrigger value="register" className="rounded-lg font-semibold py-1.5 transition-all">Register</TabsTrigger>
              </TabsList>

              <TabsContent value="login">
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">Email Address</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@domain.com"
                      value={loginForm.email}
                      onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                      className="rounded-xl border-border/40 focus-visible:ring-primary/30"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="••••••••"
                      value={loginForm.password}
                      onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                      className="rounded-xl border-border/40 focus-visible:ring-primary/30"
                      required
                    />
                  </div>
                  <Button type="submit" disabled={loading} className="w-full bg-primary hover:bg-[#C87D12] text-primary-foreground font-semibold rounded-xl py-5 shadow-md shadow-primary/10 transition-all hover:shadow-lg hover:translate-y-[-1px] active:translate-y-[0px] duration-150">
                    {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Sign in
                  </Button>
                </form>
              </</TabsContent>

              <TabsContent value="register">
                <form onSubmit={handleRegister} className="space-y-3.5">
                  <div className="space-y-2.5">
                    <Label htmlFor="r-name" className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">Full Name</Label>
                    <Input
                      id="r-name"
                      placeholder="John Doe"
                      value={registerForm.name}
                      onChange={(e) => setRegisterForm({ ...registerForm, name: e.target.value })}
                      className="rounded-xl border-border/40 focus-visible:ring-primary/30"
                      required
                    />
                  </div>
                  <div className="space-y-2.5">
                    <Label htmlFor="r-username" className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">Username</Label>
                    <Input
                      id="r-username"
                      placeholder="johndoe"
                      value={registerForm.username}
                      onChange={(e) => setRegisterForm({ ...registerForm, username: e.target.value })}
                      className="rounded-xl border-border/40 focus-visible:ring-primary/30"
                      required
                    />
                  </div>
                  <div className="space-y-2.5">
                    <Label htmlFor="r-email" className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">Email Address</Label>
                    <Input
                      id="r-email"
                      type="email"
                      placeholder="john@example.com"
                      value={registerForm.email}
                      onChange={(e) => setRegisterForm({ ...registerForm, email: e.target.value })}
                      className="rounded-xl border-border/40 focus-visible:ring-primary/30"
                      required
                    />
                  </div>
                  <div className="space-y-2.5">
                    <Label htmlFor="r-password" className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">Password</Label>
                    <Input
                      id="r-password"
                      type="password"
                      placeholder="Choose a strong password"
                      value={registerForm.password}
                      onChange={(e) => setRegisterForm({ ...registerForm, password: e.target.value })}
                      className="rounded-xl border-border/40 focus-visible:ring-primary/30"
                      required
                      minLength={6}
                    />
                  </div>
                  <Button type="submit" disabled={loading} className="w-full bg-primary hover:bg-[#C87D12] text-primary-foreground font-semibold rounded-xl py-5 shadow-md shadow-primary/10 transition-all hover:shadow-lg hover:translate-y-[-1px] active:translate-y-[0px] duration-150">
                    {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Create account
                  </Button>
                </form>
              </TabsContent>
            </Tabs>

            <div className="mt-5 pt-4 border-t border-border/40">
              <Button
                onClick={handleSeedAndLogin}
                variant="outline"
                size="sm"
                className="w-full text-xs rounded-xl py-4 border-border/40 hover:bg-muted/50 font-semibold"
                disabled={loading}
              >
                <Sparkles className="h-3.5 w-3.5 mr-2 text-accent-foreground" />
                Seed demo accounts (alice, bob, carol)
              </Button>
              <p className="text-[11px] text-muted-foreground mt-2.5 text-center leading-relaxed">
                Quick testing: <code className="text-foreground bg-muted/60 px-1.5 py-0.5 rounded font-mono text-[10px]">alice@chat.dev</code> / <code className="text-foreground bg-muted/60 px-1.5 py-0.5 rounded font-mono text-[10px]">password123</code>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
