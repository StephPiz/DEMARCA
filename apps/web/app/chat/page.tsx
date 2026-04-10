"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { requireTokenOrRedirect } from "../lib/auth";
import { useStorePermissions } from "../lib/access";
import { usePresence } from "../lib/presence";

const API_BASE = "http://localhost:3001";
const CHAT_EMOJIS = ["😀", "😊", "😉", "😍", "🙏", "🔥", "👍", "💜"];
const CHAT_PREVIEW_STORAGE_KEY = "tawa-chat-preview";

type ChatChannel = {
  id: string;
  code: string;
  name: string;
};

type ChatMessage = {
  id: string;
  body: string;
  linkedEntityType: string | null;
  linkedEntityId: string | null;
  createdAt: string;
  user: { id: string; fullName: string; email: string };
};

type TeamMember = {
  userId: string;
  roleKey: string;
  fullName: string;
  email: string;
  isActive: boolean;
};

type CurrentUser = {
  id?: string;
  fullName?: string;
  email?: string;
};

function formatStamp(value: string) {
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "TA";
  return parts.map((part) => part[0]?.toUpperCase() || "").join("");
}

function buildPreviewBody(body: string) {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (!normalized) return "Sin mensajes todavía.";
  return normalized.length > 78 ? `${normalized.slice(0, 75)}...` : normalized;
}

export default function ChatPage() {
  const router = useRouter();
  const { loading, storeId, error: permissionsError } = useStorePermissions();
  const { presences } = usePresence("Chat interno");
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  const [error, setError] = useState("");
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [channelId, setChannelId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([]);
  const [messageBody, setMessageBody] = useState("");
  const [linkedEntityType, setLinkedEntityType] = useState("");
  const [linkedEntityId, setLinkedEntityId] = useState("");
  const [attachedFileName, setAttachedFileName] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [currentUser] = useState<CurrentUser>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = localStorage.getItem("user");
      return raw ? (JSON.parse(raw) as CurrentUser) : {};
    } catch {
      return {};
    }
  });

  const selectedChannel = useMemo(() => channels.find((c) => c.id === channelId) || null, [channels, channelId]);

  const onlineUsers = useMemo(
    () => presences.filter((presence) => presence.status === "online"),
    [presences]
  );

  const typingPresence = useMemo(
    () => onlineUsers.find((presence) => presence.lastEvent === "Chat interno" && presence.user.id !== currentUser.id) || null,
    [onlineUsers, currentUser.id]
  );

  const orderedMessages = useMemo(
    () =>
      [...messages].sort((a, b) => {
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }),
    [messages]
  );

  const unreadCount = 0;

  const loadChannels = useCallback(async () => {
    const token = requireTokenOrRedirect();
    if (!token || !storeId) return;
    try {
      const qs = new URLSearchParams({ storeId }).toString();
      const res = await fetch(`${API_BASE}/chat/channels?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Error loading channels");
        return;
      }
      const nextChannels = Array.isArray(data.channels) ? (data.channels as ChatChannel[]) : [];
      setChannels(nextChannels);
      if (!channelId && nextChannels.length > 0) {
        setChannelId(nextChannels[0].id);
      }
    } catch {
      setError("Connection error");
    }
  }, [storeId, channelId]);

  const loadMembers = useCallback(async () => {
    const token = requireTokenOrRedirect();
    if (!token || !storeId) return;
    try {
      const res = await fetch(`${API_BASE}/stores/${encodeURIComponent(storeId)}/team`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Error loading team");
        return;
      }
      setMembers((Array.isArray(data.members) ? data.members : []).filter((member: TeamMember) => member.isActive));
    } catch {
      setError("Connection error");
    }
  }, [storeId]);

  const loadMessages = useCallback(async () => {
    const token = requireTokenOrRedirect();
    if (!token || !storeId || !channelId) return;
    try {
      const qs = new URLSearchParams({ storeId, channelId, limit: "120" }).toString();
      const res = await fetch(`${API_BASE}/chat/messages?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Error loading messages");
        return;
      }
      setMessages(Array.isArray(data.messages) ? (data.messages as ChatMessage[]) : []);
    } catch {
      setError("Connection error");
    }
  }, [storeId, channelId]);

  useEffect(() => {
    if (loading || !storeId) return;
    queueMicrotask(() => {
      void loadChannels();
      void loadMembers();
    });
  }, [loading, storeId, loadChannels, loadMembers]);

  useEffect(() => {
    if (!storeId || !channelId) return;
    queueMicrotask(() => {
      void loadMessages();
    });
    const timer = setInterval(() => {
      void loadMessages();
    }, 10000);
    return () => clearInterval(timer);
  }, [storeId, channelId, loadMessages]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const latestMessage = orderedMessages[orderedMessages.length - 1];
    if (!latestMessage) return;
    try {
      localStorage.setItem(
        CHAT_PREVIEW_STORAGE_KEY,
        JSON.stringify({
          body: buildPreviewBody(latestMessage.body),
          createdAt: latestMessage.createdAt,
          channelName: selectedChannel?.name || "Chat",
        })
      );
    } catch {
      // Best effort only.
    }
  }, [orderedMessages, selectedChannel?.name]);

  function getEntityHref(linkedEntityType: string | null, linkedEntityId: string | null) {
    if (!linkedEntityType || !linkedEntityId) return null;
    if (linkedEntityType === "sales_order") return `/store/orders?q=${encodeURIComponent(linkedEntityId)}`;
    if (linkedEntityType === "purchase_order") return `/store/purchases?q=${encodeURIComponent(linkedEntityId)}`;
    if (linkedEntityType === "return_case") return `/store/returns?q=${encodeURIComponent(linkedEntityId)}`;
    if (linkedEntityType === "product") return `/store/products?q=${encodeURIComponent(linkedEntityId)}`;
    if (linkedEntityType === "support_ticket") return `/store/support/${encodeURIComponent(linkedEntityId)}`;
    if (linkedEntityType === "team_task") return "/store/tasks";
    return null;
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const token = requireTokenOrRedirect();
    const cleanBody = messageBody.trim();
    const attachmentNote = attachedFileName ? `\n\n[Adjunto: ${attachedFileName}]` : "";
    const payloadBody = `${cleanBody}${attachmentNote}`.trim();

    if (!token || !storeId || !channelId || !payloadBody) return;
    setError("");

    const res = await fetch(`${API_BASE}/chat/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        storeId,
        channelId,
        body: payloadBody,
        linkedEntityType: linkedEntityType || null,
        linkedEntityId: linkedEntityId || null,
        mentionedUserIds,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Cannot send message");
      return;
    }

    setMessageBody("");
    setLinkedEntityType("");
    setLinkedEntityId("");
    setMentionedUserIds([]);
    setAttachedFileName("");
    setShowEmojiPicker(false);
    await loadMessages();
  }

  if (loading) return <div className="min-h-screen bg-[#E8EAEC] p-6">Cargando...</div>;
  if (permissionsError) return <div className="min-h-screen bg-[#E8EAEC] p-6 text-red-700">{permissionsError}</div>;

  return (
    <div className="min-h-screen bg-[#E8EAEC] p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        {error ? <div className="rounded-[24px] bg-[#FDECEC] px-4 py-3 text-[14px] text-[#B42318]">{error}</div> : null}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="overflow-hidden rounded-[34px] bg-[#F3F6FA] p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
            <div className="flex flex-col gap-4 border-b border-[#D9DFEA] pb-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[#D8DEE8] bg-white text-[#1B2140] shadow-[0_8px_20px_rgba(15,23,42,0.05)]">
                  <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M8 10h8" />
                    <path d="M8 14h5" />
                    <path d="M20 11.5C20 6.80558 16.1944 3 11.5 3C6.80558 3 3 6.80558 3 11.5C3 13.2717 3.54174 14.9168 4.46969 16.2783C4.78051 16.7345 4.98592 17.2834 4.86778 17.8222L4.43132 19.8121C4.28565 20.4763 4.88113 21.0718 5.54537 20.9261L7.53523 20.4897C8.07403 20.3715 8.62296 20.5769 9.07917 20.8877C10.4407 21.8157 12.0858 22.3574 13.8575 22.3574C18.5519 22.3574 22.3575 18.5518 22.3575 13.8574" />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <h1 className="text-[34px] leading-none text-[#10152E]">Chat</h1>
                    {unreadCount > 0 ? (
                      <span className="flex h-10 min-w-10 items-center justify-center rounded-full bg-[#B8ADF7] px-3 text-[15px] text-white">
                        {unreadCount}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-[14px] text-[#5E657B]">
                    {selectedChannel ? `Canal activo: ${selectedChannel.name}` : "Elige un canal para empezar a conversar."}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="h-11 rounded-full border border-[#D9DFEA] bg-white px-4 text-[14px] text-[#25304F] outline-none"
                  value={channelId}
                  onChange={(e) => setChannelId(e.target.value)}
                >
                  {channels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.name}
                    </option>
                  ))}
                </select>
                {selectedChannel?.code ? (
                  <span className="rounded-full bg-white px-4 py-2 text-[12px] text-[#596174] shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
                    #{selectedChannel.code}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <div className="text-[14px] text-[#31374C]">
                {typingPresence ? `${typingPresence.user.fullName} está escribiendo...` : "Conversación del equipo"}
              </div>
              <div className="flex -space-x-2">
                {onlineUsers.slice(0, 4).map((presence) => (
                  <div key={presence.id} className="relative">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#F3F6FA] bg-[#D8DDF0] text-[12px] font-semibold text-[#1B2140]">
                      {getInitials(presence.user.fullName)}
                    </div>
                    <span className="absolute bottom-0 left-0 h-3 w-3 rounded-full border-2 border-[#F3F6FA] bg-[#22C55E]" />
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 h-[520px] overflow-y-auto rounded-[28px] bg-[#EEF2F7] px-4 py-5">
              {orderedMessages.length === 0 ? (
                <div className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-[#D4D9E4] bg-white/70 px-6 text-center text-[14px] text-[#6E768E]">
                  No hay mensajes todavía en este canal.
                </div>
              ) : (
                <div className="space-y-4">
                  {orderedMessages.map((message) => {
                    const isOwn = message.user.id === currentUser.id || (!!currentUser.email && message.user.email === currentUser.email);
                    const href = getEntityHref(message.linkedEntityType, message.linkedEntityId);

                    return (
                      <div key={message.id} className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[min(78%,620px)] ${isOwn ? "items-end" : "items-start"} flex flex-col gap-2`}>
                          {!isOwn ? (
                            <div className="flex items-center gap-2 px-1 text-[12px] text-[#616984]">
                              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#22304A] shadow-[0_6px_14px_rgba(15,23,42,0.06)]">
                                {getInitials(message.user.fullName)}
                              </span>
                              <span>{message.user.fullName}</span>
                            </div>
                          ) : null}

                          <div
                            className={`rounded-[26px] px-5 py-4 shadow-[0_8px_20px_rgba(15,23,42,0.05)] ${
                              isOwn ? "rounded-br-[10px] bg-[#F6B6E8] text-[#1C2138]" : "rounded-bl-[10px] bg-white text-[#22304A]"
                            }`}
                          >
                            <div className="whitespace-pre-wrap text-[15px] leading-[1.55]">{message.body}</div>

                            {message.linkedEntityType && message.linkedEntityId ? (
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <span className="rounded-full bg-white/75 px-3 py-1 text-[11px] text-[#3147D4]">
                                  {message.linkedEntityType} #{message.linkedEntityId}
                                </span>
                                {href ? (
                                  <button
                                    type="button"
                                    className="rounded-full border border-[#D4D9E4] bg-white px-3 py-1 text-[11px] text-[#25304F] hover:bg-[#F7F9FC]"
                                    onClick={() => router.push(href)}
                                  >
                                    Abrir
                                  </button>
                                ) : null}
                              </div>
                            ) : null}

                            <div className={`mt-3 text-[12px] ${isOwn ? "text-right text-[#2A3045]" : "text-[#98A0B3]"}`}>{formatStamp(message.createdAt)}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <form onSubmit={sendMessage} className="mt-5 space-y-3">
              {showEmojiPicker ? (
                <div className="flex flex-wrap gap-2 rounded-[22px] bg-white px-4 py-3 shadow-[0_8px_22px_rgba(15,23,42,0.06)]">
                  {CHAT_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      className="text-[20px]"
                      onClick={() => {
                        setMessageBody((prev) => `${prev}${emoji}`);
                        setShowEmojiPicker(false);
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              ) : null}

              {attachedFileName ? (
                <div className="inline-flex rounded-full bg-white px-4 py-2 text-[12px] text-[#596174] shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
                  Documento: {attachedFileName}
                </div>
              ) : null}

              <div className="flex items-center gap-3 rounded-[28px] bg-white px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.07)]">
                <button type="button" className="text-[22px] text-[#A2A8B8]" onClick={() => setShowEmojiPicker((prev) => !prev)}>
                  ☺
                </button>
                <input
                  value={messageBody}
                  onChange={(e) => setMessageBody(e.target.value)}
                  placeholder="Escribe tu mensaje"
                  className="min-w-0 flex-1 bg-transparent text-[15px] text-[#344054] outline-none placeholder:text-[#98A0B3]"
                />
                <button
                  type="button"
                  className="text-[20px] text-[#A2A8B8]"
                  onClick={() => attachmentInputRef.current?.click()}
                >
                  📎
                </button>
                <input
                  ref={attachmentInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    setAttachedFileName(file ? file.name : "");
                    if (e.target) e.target.value = "";
                  }}
                />
                <button
                  type="submit"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[#B8ADF7] text-[15px] text-white shadow-[0_10px_24px_rgba(184,173,247,0.35)] hover:bg-[#a99df3]"
                >
                  ➤
                </button>
              </div>
            </form>
          </section>

          <aside className="space-y-4">
            <section className="rounded-[28px] bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.07)]">
              <h2 className="text-[22px] text-[#10152E]">Canales</h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {channels.map((channel) => (
                  <button
                    key={channel.id}
                    type="button"
                    onClick={() => setChannelId(channel.id)}
                    className={`rounded-full px-4 py-2 text-[13px] transition ${
                      channel.id === channelId ? "bg-[#121633] text-white" : "bg-[#F3F6FA] text-[#4F5568] hover:bg-[#E7ECF4]"
                    }`}
                  >
                    #{channel.code}
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-[28px] bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.07)]">
              <h2 className="text-[22px] text-[#10152E]">Equipo online</h2>
              <div className="mt-4 space-y-3">
                {members.length === 0 ? (
                  <div className="rounded-[22px] bg-[#F3F6FA] px-4 py-3 text-[13px] text-[#6E768E]">Sin miembros cargados.</div>
                ) : (
                  members.map((member) => {
                    const isOnline = onlineUsers.some((presence) => presence.user.id === member.userId);
                    return (
                      <div key={member.userId} className="flex items-center justify-between rounded-[22px] bg-[#F3F6FA] px-4 py-3">
                        <div>
                          <div className="text-[14px] text-[#141A39]">{member.fullName}</div>
                          <div className="mt-1 text-[12px] text-[#6E768E]">{member.roleKey}</div>
                        </div>
                        <span className={`h-3 w-3 rounded-full ${isOnline ? "bg-[#22C55E]" : "bg-[#D1D5DB]"}`} />
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            <section className="rounded-[28px] bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.07)]">
              <h2 className="text-[22px] text-[#10152E]">Contexto del mensaje</h2>
              <div className="mt-4 space-y-3">
                <input
                  className="h-11 w-full rounded-full border border-[#D9DFEA] bg-[#F8FAFD] px-4 text-[14px] text-[#25304F] outline-none placeholder:text-[#8B90A0]"
                  placeholder="Entidad (sales_order, product...)"
                  value={linkedEntityType}
                  onChange={(e) => setLinkedEntityType(e.target.value)}
                />
                <input
                  className="h-11 w-full rounded-full border border-[#D9DFEA] bg-[#F8FAFD] px-4 text-[14px] text-[#25304F] outline-none placeholder:text-[#8B90A0]"
                  placeholder="ID de entidad"
                  value={linkedEntityId}
                  onChange={(e) => setLinkedEntityId(e.target.value)}
                />
                <select
                  multiple
                  className="min-h-[132px] w-full rounded-[24px] border border-[#D9DFEA] bg-[#F8FAFD] px-4 py-3 text-[13px] text-[#25304F] outline-none"
                  value={mentionedUserIds}
                  onChange={(e) => setMentionedUserIds(Array.from(e.target.selectedOptions).map((option) => option.value))}
                  title="Menciones"
                >
                  {members.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      @{member.fullName} ({member.roleKey})
                    </option>
                  ))}
                </select>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
