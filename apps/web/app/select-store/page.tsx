"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import localFont from "next/font/local";
import { logout, requireTokenOrRedirect } from "../lib/auth";

type StoreRow = {
  storeId: string;
  holdingId: string;
  storeCode: string;
  storeName: string;
  status: string;
  roleKey: string;
};

const headingFont = localFont({
  src: "../fonts/HFHySans_Black.ttf",
  variable: "--font-select-store-heading",
});

const bodyFont = localFont({
  src: "../fonts/HFHySans_Regular.ttf",
  variable: "--font-select-store-body",
});

export default function SelectStorePage() {
  const router = useRouter();
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [error, setError] = useState("");
  const [step, setStep] = useState<"list" | "store-login">("list");
  const [selectedStore, setSelectedStore] = useState<StoreRow | null>(null);
  const [storeLoginEmail, setStoreLoginEmail] = useState("admin@demarca.local");
  const [storeLoginPassword, setStoreLoginPassword] = useState("Admin123!");
  const [storeLoginError, setStoreLoginError] = useState("");
  const [storeLoginLoading, setStoreLoginLoading] = useState(false);
  const girlStyle: React.CSSProperties = {
    right: "530px",
    top: "105px",
    height: "580px",
    zIndex: 2,
  };

  useEffect(() => {
    const token = requireTokenOrRedirect();
    if (!token) return;

    const holdingId = localStorage.getItem("selectedHoldingId");
    if (!holdingId) {
      router.push("/select-holding");
      return;
    }

    (async () => {
      try {
        const res = await fetch(
          `http://localhost:3001/stores?holdingId=${encodeURIComponent(holdingId)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );

        const data = await res.json();
        if (!res.ok) return setError(data.error || "Error loading stores");

        setStores(data.stores || []);
      } catch {
        setError("Connection error (API on :3001?)");
      }
    })();
  }, [router]);

  function chooseStore(store: StoreRow) {
    setSelectedStore(store);
    setStoreLoginError("");
    setStoreLoginEmail(store.storeCode.toUpperCase() === "DEMARCA" ? "admin@demarca.local" : "admin@tawaco.local");
    setStoreLoginPassword("Admin123!");
    setStep("store-login");
  }

  async function handleStoreLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedStore) return;

    setStoreLoginLoading(true);
    setStoreLoginError("");

    try {
      const res = await fetch("http://localhost:3001/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: storeLoginEmail, password: storeLoginPassword }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStoreLoginError(String(data?.error || "No se pudo iniciar sesion"));
        setStoreLoginLoading(false);
        return;
      }

      localStorage.setItem("accessToken", data.accessToken);
      localStorage.setItem("user", JSON.stringify(data.user));
      localStorage.setItem("stores", JSON.stringify(data.stores || []));
      localStorage.setItem("selectedHoldingId", selectedStore.holdingId);
      localStorage.setItem("selectedStoreId", selectedStore.storeId);
      router.push("/store/dashboarddemarca");
    } catch {
      setStoreLoginError("Connection error (API on :3001?)");
    }

    setStoreLoginLoading(false);
  }

  const orderedStores = [...stores].sort((a, b) => a.storeName.localeCompare(b.storeName, "es"));

  return (
    <div
      className={`${headingFont.variable} ${bodyFont.variable} relative min-h-screen w-screen overflow-hidden`}
      style={{ background: "linear-gradient(135deg, #2C2F95 0%, #3A42C5 45%, #4A57E6 100%)" }}
    >
      <section className="absolute inset-0 z-[1]">
        <div className="absolute left-1/2 top-1/2 h-[780px] w-[1400px] -translate-x-1/2 -translate-y-1/2">
          <div className="absolute left-[70px] top-[190px] w-[460px] text-white">
            <p className="mb-[8px] text-[66px] font-semibold leading-[66px]" style={{ fontFamily: "var(--font-select-store-heading)" }}>
              Hello
            </p>
            <h1 className="text-[82px] font-extrabold leading-[80px] tracking-[-1px]" style={{ fontFamily: "var(--font-select-store-heading)" }}>
              TAWA Co!
            </h1>
          </div>

          <Image
            src="/branding/chica01.png"
            alt="TAWA illustration"
            width={920}
            height={700}
            className="pointer-events-none absolute w-auto object-contain"
            style={girlStyle}
            priority
          />

          <p className="absolute bottom-[26px] left-[70px] text-[18px] font-medium text-white/45" style={{ fontFamily: "var(--font-select-store-body)" }}>
            2026 Tawa Co. All rights reserved.
          </p>
        </div>
      </section>

      <section className="absolute inset-0 z-[5]">
        <div className="absolute left-1/2 top-1/2 h-[780px] w-[1400px] -translate-x-1/2 -translate-y-1/2">
          <section
            className="absolute right-[110px] top-[70px] h-[620px] w-[500px] rounded-[30px] bg-[#F3F5F9] p-[42px] text-[#0E1530]"
            style={{ boxShadow: "0px 22px 55px rgba(0,0,0,0.25)" }}
          >
            <button className="absolute right-[42px] top-[22px] text-[20px] text-[#666] hover:text-[#0E1530]" onClick={logout}>
              Logout
            </button>

            {step === "list" ? (
              <>
                <h2
                  className="mt-[96px] -mb-[24px] translate-y-[60px] text-center text-[31px] font-black leading-[1.1]"
                  style={{ fontFamily: "var(--font-select-store-heading)" }}
                >
                  Elige tu tienda
                </h2>

                {error ? (
                  <div className="mt-4 rounded-xl bg-red-100 px-4 py-3 text-base text-red-700">
                    {error}
                  </div>
                ) : null}

                <div className="mt-[120px] flex max-h-[360px] flex-col gap-[18px] overflow-y-auto pr-1" style={{ fontFamily: "var(--font-select-store-body)" }}>
                  {orderedStores.length > 0 ? (
                    orderedStores.map((store) => (
                      <button
                        key={store.storeId}
                        className="h-[66px] w-full rounded-full border-none bg-white text-center text-[24px] text-[#666] transition-colors hover:bg-[#4449CD26] active:bg-[#4449CD26]"
                        style={{ boxShadow: "inset 0px 0px 0px 1px rgba(15,20,40,0.06)" }}
                        type="button"
                        onClick={() => chooseStore(store)}
                      >
                        {store.storeName.toLowerCase()}
                      </button>
                    ))
                  ) : (
                    <div className="rounded-xl bg-white px-4 py-3 text-center text-[16px] text-[#666]">
                      No hay tiendas disponibles
                    </div>
                  )}

                  <button
                    className="h-[66px] w-full rounded-full border-2 border-dashed border-[#6142C4] bg-[#4449CC26] text-center text-[24px] text-[#6142C4] transition-all duration-200 hover:-translate-y-[1px] hover:border-[#5331bb] hover:bg-[#6142C429] hover:text-[#5331bb] hover:shadow-[0_10px_22px_rgba(97,66,196,0.22)] active:translate-y-0 active:bg-[#6142C433]"
                    type="button"
                    onClick={() => router.push("/add-store")}
                  >
                    + Agregar tienda
                  </button>
                </div>

                <button
                  className="absolute bottom-[26px] left-[42px] text-[20px] text-[#666] hover:text-[#0E1530]"
                  style={{ fontFamily: "var(--font-select-store-body)" }}
                  type="button"
                  onClick={() => router.push("/select-holding")}
                >
                  ← Volver a holdings
                </button>
              </>
            ) : (
              <>
                <button
                  className="absolute right-[42px] top-[22px] text-[20px] text-[#666] hover:text-[#0E1530]"
                  style={{ fontFamily: "var(--font-select-store-body)" }}
                  type="button"
                  onClick={() => setStep("list")}
                >
                  Volver
                </button>

                <h2
                  className="mt-[96px] text-[31px] font-black leading-[1.1]"
                  style={{ fontFamily: "var(--font-select-store-heading)" }}
                >
                  Acceso {selectedStore?.storeName || "tienda"}
                </h2>

                {storeLoginError ? (
                  <div className="mt-6 rounded-xl bg-red-100 px-4 py-3 text-base text-red-700">
                    {storeLoginError}
                  </div>
                ) : null}

                <form onSubmit={handleStoreLogin} className="mt-[64px] flex flex-col gap-[18px]" style={{ fontFamily: "var(--font-select-store-body)" }}>
                  <input
                    id="store-login-email"
                    name="store-login-email"
                    autoComplete="username"
                    className="h-[66px] w-full rounded-full border-none bg-white px-[24px] text-[24px] text-[#1A2238] outline-none placeholder:text-[rgba(20,25,45,0.35)]"
                    style={{ boxShadow: "inset 0px 0px 0px 1px rgba(15,20,40,0.06)" }}
                    type="email"
                    placeholder="Email tienda"
                    value={storeLoginEmail}
                    onChange={(e) => setStoreLoginEmail(e.target.value)}
                  />

                  <input
                    id="store-login-password"
                    name="store-login-password"
                    autoComplete="current-password"
                    className="h-[66px] w-full rounded-full border-none bg-white px-[24px] text-[24px] text-[#1A2238] outline-none placeholder:text-[rgba(20,25,45,0.35)]"
                    style={{ boxShadow: "inset 0px 0px 0px 1px rgba(15,20,40,0.06)" }}
                    type="password"
                    placeholder="Contrasena tienda"
                    value={storeLoginPassword}
                    onChange={(e) => setStoreLoginPassword(e.target.value)}
                  />

                  <button
                    className="mt-[18px] h-[74px] w-full rounded-full border-none bg-[#0B1230] text-[22px] font-medium text-white transition-colors hover:cursor-pointer hover:bg-[#121B42]"
                    style={{ boxShadow: "0px 14px 26px rgba(0,0,0,0.28)" }}
                    disabled={storeLoginLoading}
                    type="submit"
                  >
                    {storeLoginLoading ? "Loading..." : `Entrar a ${String(selectedStore?.storeName || "tienda").toLowerCase()}`}
                  </button>
                </form>
              </>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
