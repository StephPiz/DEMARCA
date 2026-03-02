"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { requireTokenOrRedirect } from "../lib/auth";
import Topbar from "../components/topbar";
import { useI18n } from "../lib/i18n";

const API_BASE = "http://localhost:3001";

type ProductRow = {
  id: string;
  ean: string;
  brand: string;
  model: string;
  name: string;
  type: string;
  status: string;
};

export default function ProductsPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [storeId, setStoreId] = useState("");
  const [storeName, setStoreName] = useState("");
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [ean, setEan] = useState("");
  const [type, setType] = useState("watch");

  async function loadProducts(currentStoreId: string, q: string) {
    const token = requireTokenOrRedirect();
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ storeId: currentStoreId, q });
      const res = await fetch(`${API_BASE}/products?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Error loading products");
        setProducts([]);
      } else {
        setProducts(Array.isArray(data.products) ? data.products : []);
      }
    } catch {
      setError("Connection error");
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const token = requireTokenOrRedirect();
    if (!token) return;
    const selectedStoreId = localStorage.getItem("selectedStoreId");
    if (!selectedStoreId) {
      router.push("/select-store");
      return;
    }
    setStoreId(selectedStoreId);

    try {
      const storesRaw = localStorage.getItem("stores");
      if (storesRaw) {
        const stores = JSON.parse(storesRaw) as { storeId: string; storeName: string }[];
        const found = stores.find((s) => s.storeId === selectedStoreId);
        setStoreName(found?.storeName || "");
      }
    } catch {}

    loadProducts(selectedStoreId, "");
  }, [router]);

  async function createProduct(e: React.FormEvent) {
    e.preventDefault();
    const token = requireTokenOrRedirect();
    if (!token || !storeId) return;
    setError("");
    try {
      const res = await fetch(`${API_BASE}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          storeId,
          brand: brand.trim(),
          model: model.trim(),
          ean: ean.trim() || undefined,
          type,
          name: `${brand.trim()} ${model.trim()}`.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Cannot create product");
        return;
      }

      setBrand("");
      setModel("");
      setEan("");
      await loadProducts(storeId, query);
      router.push(`/products/${data.product.id}`);
    } catch {
      setError("Connection error");
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        <Topbar title={t("products")} storeName={storeName} />

        <div className="bg-white p-4 rounded-2xl shadow-md">
          <form
            className="grid md:grid-cols-[1fr_1fr_1fr_160px_auto] gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!storeId) return;
              loadProducts(storeId, query);
            }}
          >
            <input
              className="border rounded px-3 py-2"
              placeholder="EAN / Marca / Modelo"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="text-sm text-gray-500 md:col-span-3 self-center">{products.length} items</div>
            <button className="border rounded px-4 py-2 hover:bg-gray-50" type="submit">
              {t("search")}
            </button>
          </form>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-md">
          <h2 className="font-semibold mb-3">Crear producto</h2>
          <form className="grid md:grid-cols-5 gap-2" onSubmit={createProduct}>
            <input
              className="border rounded px-3 py-2"
              placeholder="Marca"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              required
            />
            <input
              className="border rounded px-3 py-2"
              placeholder="Modelo"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              required
            />
            <input
              className="border rounded px-3 py-2"
              placeholder="EAN (opcional)"
              value={ean}
              onChange={(e) => setEan(e.target.value)}
            />
            <select className="border rounded px-3 py-2" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="watch">watch</option>
              <option value="bag">bag</option>
              <option value="perfume">perfume</option>
              <option value="accessory">accessory</option>
              <option value="vintage">vintage</option>
              <option value="refurbished">refurbished</option>
              <option value="other">other</option>
            </select>
            <button className="rounded bg-black text-white px-3 py-2" type="submit">
              {t("create")}
            </button>
          </form>
          {error ? <div className="mt-2 text-sm text-red-600">{error}</div> : null}
        </div>

        <div className="bg-white rounded-2xl shadow-md overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-3 py-2">EAN</th>
                <th className="text-left px-3 py-2">Marca</th>
                <th className="text-left px-3 py-2">Modelo</th>
                <th className="text-left px-3 py-2">Tipo</th>
                <th className="text-left px-3 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-gray-500">
                    Cargando...
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-gray-500">
                    Sin productos
                  </td>
                </tr>
              ) : (
                products.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b hover:bg-gray-50 cursor-pointer"
                    onClick={() => router.push(`/products/${p.id}`)}
                  >
                    <td className="px-3 py-2">{p.ean}</td>
                    <td className="px-3 py-2">{p.brand}</td>
                    <td className="px-3 py-2">{p.model}</td>
                    <td className="px-3 py-2">{p.type}</td>
                    <td className="px-3 py-2">{p.status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
