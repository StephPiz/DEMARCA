"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { requireTokenOrRedirect } from "../../lib/auth";
import Topbar from "../../components/topbar";

const API_BASE = "http://localhost:3001";

type ProductPayload = {
  id: string;
  ean: string;
  sku: string | null;
  type: string;
  brand: string;
  model: string;
  name: string;
  status: string;
  internalDescription: string | null;
  eanAliases: { id: string; ean: string; source: string }[];
  listings: {
    id: string;
    listingStatus: string;
    publicName: string | null;
    listingUrl: string | null;
    priceOriginal: string | null;
    priceCurrencyCode: string | null;
    channel: { id: string; name: string; code: string };
  }[];
  texts: { id: string; locale: string; publicName: string; description: string | null; channelId: string | null }[];
  lots: {
    id: string;
    lotCode: string;
    quantityAvailable: number;
    quantityReceived: number;
    status: string;
    unitCostEurFrozen?: number;
    warehouse: { code: string; name: string };
  }[];
  movements: {
    id: string;
    movementType: string;
    quantity: number;
    createdAt: string;
    warehouse: { code: string };
    createdBy: { fullName: string } | null;
  }[];
};

type Channel = { id: string; name: string; code: string };

export default function ProductDetailPage() {
  const { productId } = useParams<{ productId: string }>();
  const [storeId, setStoreId] = useState("");
  const [storeName, setStoreName] = useState("");
  const [product, setProduct] = useState<ProductPayload | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [aliasValue, setAliasValue] = useState("");
  const [textLocale, setTextLocale] = useState("es");
  const [textName, setTextName] = useState("");
  const [textDescription, setTextDescription] = useState("");
  const [channelId, setChannelId] = useState("");
  const [channelPrice, setChannelPrice] = useState("");

  const loadAll = useCallback(async (currentStoreId: string) => {
    const token = requireTokenOrRedirect();
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const [productRes, channelRes] = await Promise.all([
        fetch(`${API_BASE}/products/${productId}?storeId=${encodeURIComponent(currentStoreId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_BASE}/stores/${currentStoreId}/channels`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      const productData = await productRes.json();
      const channelData = await channelRes.json();

      if (!productRes.ok) {
        setError(productData.error || "Error loading product");
        setProduct(null);
      } else {
        setProduct(productData.product);
      }

      if (channelRes.ok) setChannels(channelData.channels || []);
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    const token = requireTokenOrRedirect();
    if (!token) return;
    const selectedStoreId = localStorage.getItem("selectedStoreId");
    if (!selectedStoreId) return;
    setStoreId(selectedStoreId);

    try {
      const storesRaw = localStorage.getItem("stores");
      if (storesRaw) {
        const stores = JSON.parse(storesRaw) as { storeId: string; storeName: string }[];
        setStoreName(stores.find((s) => s.storeId === selectedStoreId)?.storeName || "");
      }
    } catch {}

    loadAll(selectedStoreId);
  }, [loadAll]);

  async function addAlias(e: React.FormEvent) {
    e.preventDefault();
    const token = requireTokenOrRedirect();
    if (!token || !storeId || !aliasValue.trim()) return;
    const res = await fetch(`${API_BASE}/products/${productId}/ean-aliases`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ storeId, ean: aliasValue.trim(), source: "manual" }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error || "Cannot add alias");
    setAliasValue("");
    loadAll(storeId);
  }

  async function saveText(e: React.FormEvent) {
    e.preventDefault();
    const token = requireTokenOrRedirect();
    if (!token || !storeId || !textName.trim()) return;
    const res = await fetch(`${API_BASE}/products/${productId}/texts`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        storeId,
        locale: textLocale,
        publicName: textName.trim(),
        description: textDescription.trim() || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error || "Cannot save text");
    setTextName("");
    setTextDescription("");
    loadAll(storeId);
  }

  async function saveChannelListing(e: React.FormEvent) {
    e.preventDefault();
    const token = requireTokenOrRedirect();
    if (!token || !storeId || !channelId) return;
    const res = await fetch(`${API_BASE}/products/${productId}/channel/${channelId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        storeId,
        listingStatus: "active",
        publicName: product?.name || "",
        priceOriginal: channelPrice || null,
        priceCurrencyCode: "EUR",
        priceFxToEur: "1",
      }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error || "Cannot save listing");
    setChannelPrice("");
    loadAll(storeId);
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        <Topbar title={`Producto ${product?.model || ""}`} storeName={storeName} />

        {error ? <div className="bg-red-100 text-red-700 p-3 rounded">{error}</div> : null}

        {loading || !product ? (
          <div className="bg-white p-4 rounded-2xl shadow-md text-sm text-gray-600">Cargando...</div>
        ) : (
          <>
            <div className="bg-white p-4 rounded-2xl shadow-md grid md:grid-cols-2 gap-4">
              <div>
                <h2 className="font-semibold mb-2">Datos del producto</h2>
                <div className="text-sm space-y-1">
                  <div>
                    <b>EAN:</b> {product.ean}
                  </div>
                  <div>
                    <b>Marca:</b> {product.brand}
                  </div>
                  <div>
                    <b>Modelo:</b> {product.model}
                  </div>
                  <div>
                    <b>Tipo:</b> {product.type}
                  </div>
                  <div>
                    <b>Estado:</b> {product.status}
                  </div>
                </div>
              </div>

              <div>
                <h2 className="font-semibold mb-2">Alias EAN</h2>
                <form className="flex gap-2 mb-2" onSubmit={addAlias}>
                  <input
                    className="border rounded px-3 py-2 w-full"
                    placeholder="Nuevo alias EAN"
                    value={aliasValue}
                    onChange={(e) => setAliasValue(e.target.value)}
                  />
                  <button className="bg-black text-white rounded px-3 py-2" type="submit">
                    Agregar
                  </button>
                </form>
                <div className="text-sm text-gray-700">
                  {product.eanAliases.length === 0 ? "Sin alias" : product.eanAliases.map((a) => a.ean).join(", ")}
                </div>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl shadow-md">
              <h2 className="font-semibold mb-2">Textos por idioma</h2>
              <form className="grid md:grid-cols-4 gap-2 mb-3" onSubmit={saveText}>
                <select className="border rounded px-3 py-2" value={textLocale} onChange={(e) => setTextLocale(e.target.value)}>
                  <option value="es">es</option>
                  <option value="it">it</option>
                  <option value="pt">pt</option>
                  <option value="en">en</option>
                  <option value="de">de</option>
                </select>
                <input
                  className="border rounded px-3 py-2"
                  placeholder="Nombre publico"
                  value={textName}
                  onChange={(e) => setTextName(e.target.value)}
                />
                <input
                  className="border rounded px-3 py-2"
                  placeholder="Descripcion"
                  value={textDescription}
                  onChange={(e) => setTextDescription(e.target.value)}
                />
                <button className="rounded bg-black text-white px-3 py-2" type="submit">
                  Guardar
                </button>
              </form>
              <div className="text-sm text-gray-700">
                {product.texts.map((tx) => (
                  <div key={tx.id}>
                    [{tx.locale}] {tx.publicName}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl shadow-md">
              <h2 className="font-semibold mb-2">Publicaciones por canal</h2>
              <form className="grid md:grid-cols-3 gap-2 mb-3" onSubmit={saveChannelListing}>
                <select className="border rounded px-3 py-2" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
                  <option value="">Seleccionar canal</option>
                  {channels.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.name}
                    </option>
                  ))}
                </select>
                <input
                  className="border rounded px-3 py-2"
                  placeholder="Precio EUR"
                  value={channelPrice}
                  onChange={(e) => setChannelPrice(e.target.value)}
                />
                <button className="rounded bg-black text-white px-3 py-2" type="submit">
                  Guardar canal
                </button>
              </form>
              <div className="text-sm text-gray-700">
                {product.listings.map((ls) => (
                  <div key={ls.id}>
                    {ls.channel.name}: {ls.priceOriginal || "-"} {ls.priceCurrencyCode || ""}
                  </div>
                ))}
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-white p-4 rounded-2xl shadow-md">
                <h2 className="font-semibold mb-2">Lotes FIFO</h2>
                <div className="text-sm space-y-1">
                  {product.lots.map((lot) => (
                    <div key={lot.id}>
                      {lot.lotCode} · {lot.warehouse.code} · {lot.quantityAvailable}/{lot.quantityReceived}
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white p-4 rounded-2xl shadow-md">
                <h2 className="font-semibold mb-2">Historial</h2>
                <div className="text-sm space-y-1">
                  {product.movements.map((mv) => (
                    <div key={mv.id}>
                      {new Date(mv.createdAt).toLocaleString()} · {mv.movementType} · {mv.quantity}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
