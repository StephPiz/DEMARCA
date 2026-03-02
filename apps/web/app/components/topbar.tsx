"use client";

import { useRouter } from "next/navigation";
import { logout } from "../lib/auth";
import { useI18n } from "../lib/i18n";

type Props = {
  title: string;
  storeName?: string;
};

export default function Topbar({ title, storeName }: Props) {
  const router = useRouter();
  const { locale, changeLocale, t, supportedLocales } = useI18n();

  return (
    <div className="bg-white p-4 rounded-2xl shadow-md">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="text-sm text-gray-600">
            {t("store")}: <b>{storeName || "-"}</b>
          </p>
        </div>

        <div className="flex gap-2 items-center">
          <select
            value={locale}
            onChange={(e) => changeLocale(e.target.value)}
            className="border rounded px-2 py-2 text-sm"
          >
            {supportedLocales.map((l) => (
              <option value={l} key={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </select>
          <button className="px-3 py-2 rounded border hover:bg-gray-50" onClick={() => router.push("/dashboard")}>
            {t("dashboard")}
          </button>
          <button className="px-3 py-2 rounded border hover:bg-gray-50" onClick={() => router.push("/inventory")}>
            {t("inventory")}
          </button>
          <button className="px-3 py-2 rounded border hover:bg-gray-50" onClick={() => router.push("/products")}>
            {t("products")}
          </button>
          <button className="px-3 py-2 rounded border hover:bg-gray-50" onClick={() => router.push("/orders")}>
            {t("orders")}
          </button>
          <button className="px-3 py-2 rounded border hover:bg-gray-50" onClick={() => router.push("/payouts")}>
            {t("payouts")}
          </button>
          <button className="px-3 py-2 rounded border hover:bg-gray-50" onClick={() => router.push("/invoices")}>
            {t("invoices")}
          </button>
          <button className="px-3 py-2 rounded border hover:bg-gray-50" onClick={() => router.push("/settings")}>
            {t("settings")}
          </button>
          <button className="px-3 py-2 rounded bg-black text-white" onClick={logout}>
            {t("logout")}
          </button>
        </div>
      </div>
    </div>
  );
}
