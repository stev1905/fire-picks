export function ChefLoading({ message = "Chefing up today's data..." }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center select-none">
      <div className="relative">
        {/* Chef hat */}
        <div className="text-7xl animate-bounce" style={{ animationDuration: "1.2s" }}>
          👨🏾‍🍳
        </div>
        {/* Steam puffs */}
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 flex gap-1">
          <span
            className="text-lg opacity-0"
            style={{ animation: "steam 2s ease-in-out infinite", animationDelay: "0s" }}
          >
            〰️
          </span>
          <span
            className="text-lg opacity-0"
            style={{ animation: "steam 2s ease-in-out infinite", animationDelay: "0.4s" }}
          >
            〰️
          </span>
          <span
            className="text-lg opacity-0"
            style={{ animation: "steam 2s ease-in-out infinite", animationDelay: "0.8s" }}
          >
            〰️
          </span>
        </div>
      </div>

      <div>
        <p className="text-lg font-semibold tracking-wide">{message}</p>
        <p className="text-sm text-muted-foreground mt-1">
          Hang tight while we pull today&apos;s data
        </p>
      </div>

      <style>{`
        @keyframes steam {
          0%   { opacity: 0; transform: translateY(0) scale(0.8); }
          30%  { opacity: 0.7; }
          100% { opacity: 0; transform: translateY(-24px) scale(1.3); }
        }
      `}</style>
    </div>
  );
}
