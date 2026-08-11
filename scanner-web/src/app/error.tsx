"use client";

export default function ErrorPage({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <div className="min-h-screen bg-page flex items-center justify-center p-6">
            <div className="glass-strong rounded-3xl max-w-lg w-full p-8 text-center flex flex-col gap-4">
                <span className="text-5xl">⚠️</span>
                <h1 className="font-display text-xl text-ink uppercase tracking-[0.08em]">Algo salió mal</h1>
                <p className="text-sm text-muted">
                    Ocurrió un error inesperado en la aplicación. Tus datos están a salvo en el servidor.
                </p>
                <div className="bg-field border border-line rounded-xl p-4 text-left overflow-auto max-h-40">
                    <p className="text-[11px] font-mono text-red-700 break-all">{error?.message || 'Error desconocido'}</p>
                    {error?.digest && <p className="text-[10px] font-mono text-faint mt-1">digest: {error.digest}</p>}
                </div>
                <p className="text-[11px] text-faint">Toma un pantallazo de este mensaje y envíalo para diagnosticarlo.</p>
                <div className="flex gap-3 justify-center">
                    <button
                        onClick={() => reset()}
                        className="px-6 py-3 bg-brand-blue hover:bg-brand-blue-hover text-white font-black text-xs uppercase tracking-widest rounded-xl transition-colors"
                    >
                        Reintentar
                    </button>
                    <button
                        onClick={() => { window.location.href = '/'; }}
                        className="px-6 py-3 bg-field hover:bg-line text-ink-soft font-black text-xs uppercase tracking-widest rounded-xl border border-line transition-colors"
                    >
                        Ir al inicio
                    </button>
                </div>
            </div>
        </div>
    );
}
