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
        <div className="min-h-screen bg-[#08090B] flex items-center justify-center p-4 relative overflow-hidden">
            {/* Background Effects */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-blue-600/5 rounded-full blur-[120px]"></div>
                <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-blue-500/3 rounded-full blur-[80px]"></div>
                <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-blue-600/4 rounded-full blur-[80px]"></div>
            </div>

            <div className="w-full max-w-md relative z-10">
                {/* Logo / Brand */}
                <div className="text-center mb-10">
                    <div className="inline-flex items-center justify-center w-20 h-20 mb-6 rounded-2xl overflow-hidden shadow-[0_0_40px_rgba(37,99,235,0.3)] border border-blue-500/20">
                        <img src="/logo.png" alt="INGRESADOS" className="w-full h-full object-cover" />
                    </div>
                    <h1 className="text-3xl font-black tracking-[0.3em] text-white uppercase drop-shadow-lg">INGRESADOS</h1>
                    <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-blue-400/60 mt-2">INVENTORY & TRACKING SYSTEM</p>
                </div>

                {/* Login Card */}
                <div className="bg-[#0F1014] border border-[#1A1B20] rounded-3xl shadow-2xl shadow-black/50 overflow-hidden">
                    {/* Tab Toggle */}
                    <div className="flex border-b border-[#1A1B20]">
                        <button
                            onClick={() => { setIsLogin(true); setError(''); }}
                            className={`flex-1 flex items-center justify-center gap-2 py-4 font-bold text-xs uppercase tracking-widest transition-all ${isLogin ? 'text-blue-400 bg-blue-500/5 border-b-2 border-blue-500' : 'text-gray-600 hover:text-gray-400'}`}
                        >
                            <LogIn size={16} /> Iniciar Sesión
                        </button>
                        <button
                            onClick={() => { setIsLogin(false); setError(''); }}
                            className={`flex-1 flex items-center justify-center gap-2 py-4 font-bold text-xs uppercase tracking-widest transition-all ${!isLogin ? 'text-blue-400 bg-blue-500/5 border-b-2 border-blue-500' : 'text-gray-600 hover:text-gray-400'}`}
                        >
                            <UserPlus size={16} /> Crear Cuenta
                        </button>
                    </div>

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="p-8 flex flex-col gap-5">
                        {/* Error Display */}
                        {error && (
                            <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm font-bold animate-in slide-in-from-top-2 duration-200">
                                <AlertTriangle size={18} className="flex-shrink-0" />
                                {error}
                            </div>
                        )}

                        {/* Name (Register only) */}
                        {!isLogin && (
                            <div>
                                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Nombre (opcional)</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="w-full bg-[#0A0A0B] border border-[#1A1B20] rounded-xl px-4 py-3.5 outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all text-white font-medium placeholder-gray-600"
                                    placeholder="Tu nombre..."
                                />
                            </div>
                        )}

                        {/* Email */}
                        <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Correo Electrónico</label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                autoFocus
                                className="w-full bg-[#0A0A0B] border border-[#1A1B20] rounded-xl px-4 py-3.5 outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all text-white font-medium placeholder-gray-600"
                                placeholder="correo@ejemplo.com"
                            />
                        </div>

                        {/* Password */}
                        <div>
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Contraseña</label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                className="w-full bg-[#0A0A0B] border border-[#1A1B20] rounded-xl px-4 py-3.5 outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all text-white font-medium placeholder-gray-600"
                                placeholder="••••••••••"
                            />
                        </div>

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 disabled:cursor-not-allowed text-white font-black uppercase tracking-widest text-sm py-4 rounded-xl transition-all shadow-[0_0_30px_rgba(37,99,235,0.3)] hover:shadow-[0_0_40px_rgba(37,99,235,0.5)] active:scale-[0.98] flex items-center justify-center gap-3 mt-2"
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
                    <p className="text-[9px] font-black text-gray-500 tracking-[0.3em] uppercase mb-1">INGRESADOS V1.0</p>
                    <p className="text-[10px] font-bold text-gray-400 tracking-widest flex items-center gap-1.5 uppercase justify-center">
                        Creado por <span className="text-white bg-black px-2 py-0.5 rounded border border-gray-800">Hacheverso</span>
                    </p>
                </div>
            </div>
        </div>
    );
}
