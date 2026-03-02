"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { requireTokenOrRedirect } from "../lib/auth";
import Topbar from "../components/topbar";

type Warehouse = {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
};

type InventoryItem = {
  id: string;
  type: string;
  brand: string;
  model: string;
  name: string;
  ean: string;
  status: string;
  imageUrl: string | null;
  stockSelectedWarehouse: number;
  stockTotalStore: number;
  stockByWarehouse: {
    warehouseId: string;
    warehouseCode: string;
    warehouseName: string;
    qty: number;
  }[];
  availableElsewhere: {
    warehouseId: string;
    warehouseCode: string;
    warehouseName: string;
    qty: number;
  }[];
};

const API_BASE = "http://localhost:3001";

export default function InventoryPage() {
  const router = useRouter();
  const [storeName, setStoreName] = useState("");
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [withImages, setWithImages] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const selectedWarehouse = useMemo(
    () => warehouses.find((w) => w.id === selectedWarehouseId) || null,
    [warehouses, selectedWarehouseId]
  );

  const loadInventory = useCallback(
    async (token: string, storeId: string, warehouseId: string, q: string, showImages: boolean) => {
      setLoading(true);
      setError("");

      try {
        const params = new URLSearchParams({
          storeId,
          warehouseId,
          q,
          withImages: showImages ? "1" : "0",
        });

        const res = await fetch(`${API_BASE}/inventory?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();

        if (!res.ok) {
          setError(data.error || "Error cargando inventario");
          setItems([]);
          return;
        }

        setItems(Array.isArray(data.items) ? data.items : []);
      } catch {
        setError("Error de conexion con API");
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    const token = requireTokenOrRedirect();
    if (!token) return;

    const selectedStoreId = localStorage.getItem("selectedStoreId");
    if (!selectedStoreId) {
      router.push("/select-store");
      return;
    }

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/stores/${selectedStoreId}/bootstrap`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();

        if (!res.ok) {
          setError(data.error || "No se pudo cargar tienda");
          setLoading(false);
          return;
        }

        setStoreName(data?.store?.name || "");
        const warehouseRows = Array.isArray(data.warehouses) ? (data.warehouses as Warehouse[]) : [];
        setWarehouses(warehouseRows);

        const defaultWh = warehouseRows.find((w) => w.isDefault) || warehouseRows[0];
        if (!defaultWh) {
          setError("No hay almacenes activos configurados");
          setLoading(false);
          return;
        }

        setSelectedWarehouseId(defaultWh.id);
        await loadInventory(token, selectedStoreId, defaultWh.id, "", false);
      } catch {
        setError("Error de conexion con API");
        setLoading(false);
      }
    })();
  }, [loadInventory, router]);

  async function runSearch(nextQuery: string = query) {
    const token = requireTokenOrRedirect();
    if (!token) return;
    const selectedStoreId = localStorage.getItem("selectedStoreId");
    if (!selectedStoreId || !selectedWarehouseId) return;
    await loadInventory(token, selectedStoreId, selectedWarehouseId, nextQuery, withImages);
  }

  async function onWarehouseChange(nextWarehouseId: string) {
    setSelectedWarehouseId(nextWarehouseId);
    const token = requireTokenOrRedirect();
    if (!token) return;
    const selectedStoreId = localStorage.getItem("selectedStoreId");
    if (!selectedStoreId) return;
    await loadInventory(token, selectedStoreId, nextWarehouseId, query, withImages);
  }

  async function onToggleImages() {
    const next = !withImages;
    setWithImages(next);
    const token = requireTokenOrRedirect();
    if (!token) return;
    const selectedStoreId = localStorage.getItem("selectedStoreId");
    if (!selectedStoreId || !selectedWarehouseId) return;
    await loadInventory(token, selectedStoreId, selectedWarehouseId, query, next);
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        <Topbar title="Inventario Operativo" storeName={storeName} />

        <div className="bg-white p-6 rounded-2xl shadow-md mt-4">
          <div className="text-sm text-gray-600 mb-3">
            {selectedWarehouse ? (
              <>
                Almacen seleccionado: <b>{selectedWarehouse.name}</b>
              </>
            ) : null}
          </div>

          <div className="mt-5 grid md:grid-cols-[220px_1fr_auto] gap-3">
            <select
              className="border rounded px-3 py-2 bg-white"
              value={selectedWarehouseId}
              onChange={(e) => onWarehouseChange(e.target.value)}
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.code})
                </option>
              ))}
            </select>

            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                await runSearch();
              }}
            >
              <input
                className="w-full border rounded px-3 py-2"
                placeholder="Buscar por EAN / Modelo / Marca"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button className="px-4 py-2 rounded border hover:bg-gray-50" type="submit">
                Buscar
              </button>
            </form>

            <button
              className={`px-4 py-2 rounded border ${
                withImages ? "bg-black text-white border-black" : "bg-white hover:bg-gray-50"
              }`}
              onClick={onToggleImages}
            >
              {withImages ? "Ocultar imagenes" : "Mostrar imagenes"}
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-4 bg-red-100 text-red-700 p-3 rounded text-sm">{error}</div>
        ) : null}

        <div className="mt-4 bg-white rounded-2xl shadow-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b text-gray-700">
                <tr>
                  {withImages ? <th className="text-left px-3 py-3">Foto</th> : null}
                  <th className="text-left px-3 py-3">Tipo</th>
                  <th className="text-left px-3 py-3">Marca</th>
                  <th className="text-left px-3 py-3">Modelo</th>
                  <th className="text-left px-3 py-3">EAN</th>
                  <th className="text-left px-3 py-3">Stock Almacen</th>
                  <th className="text-left px-3 py-3">Estado</th>
                  <th className="text-left px-3 py-3">Disponible en</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="px-3 py-4 text-gray-500" colSpan={withImages ? 8 : 7}>
                      Cargando inventario...
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td className="px-3 py-4 text-gray-500" colSpan={withImages ? 8 : 7}>
                      Sin resultados para este almacen.
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id} className="border-b last:border-b-0">
                      {withImages ? (
                        <td className="px-3 py-2">
                          {item.imageUrl ? (
                            <Image
                              src={item.imageUrl}
                              alt={item.name}
                              width={56}
                              height={56}
                              className="w-14 h-14 object-cover rounded border"
                            />
                          ) : (
                            <div className="w-14 h-14 rounded border bg-gray-100 flex items-center justify-center text-xs text-gray-500">
                              Sin foto
                            </div>
                          )}
                        </td>
                      ) : null}
                      <td className="px-3 py-2">{item.type}</td>
                      <td className="px-3 py-2">{item.brand}</td>
                      <td className="px-3 py-2">{item.model}</td>
                      <td className="px-3 py-2">{item.ean}</td>
                      <td className="px-3 py-2 font-semibold">{item.stockSelectedWarehouse}</td>
                      <td className="px-3 py-2">{item.status}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">
                        {item.availableElsewhere.length === 0
                          ? "-"
                          : item.availableElsewhere
                              .map((w) => `${w.warehouseCode} (${w.qty})`)
                              .join(", ")}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
