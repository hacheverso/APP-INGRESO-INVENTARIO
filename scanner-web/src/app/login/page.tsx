"use client";

import React, { useState } from 'react';
import { ScanLine, LogIn, UserPlus, AlertTriangle, Loader2 } from 'lucide-react';

export default function LoginPage() {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
            const body: any = { email, password };
            if (!isLogin && name.trim()) body.name = name;

            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            const data = await res.json();

            if (data.success) {
                // Redirect to main app
                window.location.href = '/';
            } else {
                setError(data.error || 'Error desconocido');
            }
        } catch (err) {
            setError('Error de conexión. Intenta de nuevo.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-page flex items-center justify-center p-4 relative overflow-hidden">
            {/* Background Effects */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-brand-green/15 rounded-full blur-[120px]"></div>
                <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-brand-blue/10 rounded-full blur-[80px]"></div>
                <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-brand-green/10 rounded-full blur-[80px]"></div>
            </div>

            <div className="w-full max-w-md relative z-10">
                {/* Logo / Brand */}
                <div className="text-center mb-10">
                    <div className="inline-flex items-center justify-center w-20 h-20 mb-6 rounded-2xl overflow-hidden shadow-[0_0_40px_rgba(91,202,45,0.35)] border border-brand-green/30">
                        <img src="/logo.png" alt="INGRESADOS" className="w-full h-full object-cover" />
                    </div>
                    <h1 className="font-display text-3xl tracking-[0.3em] text-ink uppercase">INGRESADOS</h1>
                    <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-muted mt-2">INVENTORY & TRACKING SYSTEM</p>
                </div>

                {/* Login Card */}
                <div className="bg-card border border-line rounded-3xl shadow-[0_18px_50px_rgba(23,28,20,0.10)] overflow-hidden">
                    {/* Tab Toggle */}
                    <div className="flex border-b border-line">
                        <button
                            onClick={() => { setIsLogin(true); setError(''); }}
                            className={`flex-1 flex items-center justify-center gap-2 py-4 font-bold text-xs uppercase tracking-widest transition-all ${isLogin ? 'text-brand-blue bg-brand-blue/5 border-b-2 border-brand-blue' : 'text-faint hover:text-muted'}`}
                        >
                            <LogIn size={16} /> Iniciar Sesión
                        </button>
                        <button
                            onClick={() => { setIsLogin(false); setError(''); }}
                            className={`flex-1 flex items-center justify-center gap-2 py-4 font-bold text-xs uppercase tracking-widest transition-all ${!isLogin ? 'text-brand-blue bg-brand-blue/5 border-b-2 border-brand-blue' : 'text-faint hover:text-muted'}`}
                        >
                            <UserPlus size={16} /> Crear Cuenta
                        </button>
                    </div>

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="p-8 flex flex-col gap-5">
                        {/* Error Display */}
                        {error && (
                            <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-600 text-sm font-bold animate-in slide-in-from-top-2 duration-200">
                                <AlertTriangle size={18} className="flex-shrink-0" />
                                {error}
                            </div>
                        )}

                        {/* Name (Register only) */}
                        {!isLogin && (
                            <div>
                                <label className="block text-[10px] font-bold uppercase tracking-widest text-muted mb-2">Nombre (opcional)</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="w-full bg-field border border-line rounded-xl px-4 py-3.5 outline-none focus:ring-2 focus:ring-brand-blue/40 focus:border-brand-blue/50 focus:bg-white transition-all text-ink font-medium placeholder-faint"
                                    placeholder="Tu nombre..."
                                />
                            </div>
                        )}

                        {/* Email */}
                        <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-muted mb-2">Correo Electrónico</label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                autoFocus
                                className="w-full bg-field border border-line rounded-xl px-4 py-3.5 outline-none focus:ring-2 focus:ring-brand-blue/40 focus:border-brand-blue/50 focus:bg-white transition-all text-ink font-medium placeholder-faint"
                                placeholder="correo@ejemplo.com"
                            />
                        </div>

                        {/* Password */}
                        <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-muted mb-2">Contraseña</label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                className="w-full bg-field border border-line rounded-xl px-4 py-3.5 outline-none focus:ring-2 focus:ring-brand-blue/40 focus:border-brand-blue/50 focus:bg-white transition-all text-ink font-medium placeholder-faint"
                                placeholder="••••••••••"
                            />
                        </div>

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-brand-blue hover:bg-brand-blue-hover disabled:bg-brand-blue/50 disabled:cursor-not-allowed text-white font-black uppercase tracking-widest text-sm py-4 rounded-xl transition-all shadow-[0_6px_20px_rgba(58,82,218,0.35)] hover:shadow-[0_8px_26px_rgba(58,82,218,0.45)] active:scale-[0.98] flex items-center justify-center gap-3 mt-2"
                        >
                            {isLoading ? (
                                <Loader2 size={20} className="animate-spin" />
                            ) : (
                                <>
                                    <ScanLine size={20} />
                                    {isLogin ? 'Ingresar' : 'Crear Cuenta'}
                                </>
                            )}
                        </button>
                    </form>
                </div>

                {/* Footer */}
                <div className="text-center mt-8 opacity-40">
                    <p className="text-[9px] font-black text-muted tracking-[0.3em] uppercase mb-1">INGRESADOS V1.0</p>
                    <p className="text-[10px] font-bold text-muted tracking-widest flex items-center gap-1.5 uppercase justify-center">
                        Creado por <span className="text-white bg-black px-2 py-0.5 rounded border border-line">Hacheverso</span>
                    </p>
                </div>
            </div>
        </div>
    );
}
