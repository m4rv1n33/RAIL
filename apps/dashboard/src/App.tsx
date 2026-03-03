import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiFetch } from "./api.js";

type User = { id: string; isSuperuser?: boolean; canAccessDashboard?: boolean; canManage?: boolean };
type Team = {
  id: string;
  name: string;
  roles: { roleId: string }[];
};
type DiscordRole = { id: string; name: string; position: number; managed?: boolean; colorHex?: string | null };
type Category = {
  id: string;
  name: string;
  description: string;
  supportTeamId: string;
  enabled: boolean;
  parentChannelId?: string | null;
};
type PanelCategoryLink = {
  id: string;
  categoryId: string;
  enabled: boolean;
  sortOrder: number;
  category?: { id: string; name: string };
};
type Panel = {
  id: string;
  channelId: string;
  title: string;
  description: string;
  isActive: boolean;
  categories: PanelCategoryLink[];
};
type DiscordChannel = { id: string; name: string; type: number; parentId?: string | null };
type GuildSettings = { transcriptChannelId?: string; mediaForumChannelId?: string };
type TranscriptSummary = {
  ticketId: string;
  ticketLabel?: string;
  openedById: string;
  openedByName?: string;
  closedById?: string | null;
  closedByName?: string | null;
  reason?: string | null;
  openedAt: string;
  closedAt?: string | null;
};
type TranscriptDetail = {
  ticketId: string;
  ticketLabel?: string;
  openedById: string;
  openedByName?: string;
  closedById?: string | null;
  closedByName?: string | null;
  reason?: string | null;
  openedAt: string;
  closedAt?: string | null;
  content: string;
  transcriptCreatedAt: string;
};

const THEME_STORAGE_KEY = "ukrrp-dashboard-theme";
type Theme = "dark" | "light";

const getInitialTheme = (): Theme => {
  if (typeof window === "undefined") {
    return "dark";
  }
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return storedTheme === "light" || storedTheme === "dark" ? storedTheme : "dark";
};

const renderDiscordEmojiText = (value?: string | null) => {
  if (!value) {
    return value;
  }
  const emojiPattern = /<(a?):([A-Za-z0-9_~]+):(\d+)>/g;
  const parts: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = emojiPattern.exec(value)) !== null) {
    const [fullMatch, animated, name, id] = match;
    const matchStart = match.index;
    if (matchStart > cursor) {
      parts.push(value.slice(cursor, matchStart));
    }
    const extension = animated === "a" ? "gif" : "png";
    parts.push(
      <img
        key={`${id}-${matchStart}`}
        className="emoji-inline"
        src={`https://cdn.discordapp.com/emojis/${id}.${extension}?size=32&quality=lossless`}
        alt={`:${name}:`}
        title={`:${name}:`}
      />
    );
    cursor = matchStart + fullMatch.length;
  }

  if (cursor < value.length) {
    parts.push(value.slice(cursor));
  }

  return parts.length > 0 ? parts : value;
};

const formatTicketTitle = (ticketLabel?: string, ticketId?: string) => {
  const fallbackLabel = ticketId ? `ticket-${ticketId.slice(0, 6)}` : "";
  const normalized = (ticketLabel || fallbackLabel).trim();
  if (!normalized) {
    return "";
  }
  if (normalized.toLowerCase().startsWith("ticket ")) {
    return normalized;
  }
  return `Ticket ${normalized}`;
};

export const App = () => {
  const appName = "UKRRP Ticket System";
  const brandingFooter = "Powered by RAIL, built by @m4rv1n_33";
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [user, setUser] = useState<User | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [channels, setChannels] = useState<DiscordChannel[]>([]);
  const [roles, setRoles] = useState<DiscordRole[]>([]);
  const [settings, setSettings] = useState<GuildSettings>({});
  const [transcripts, setTranscripts] = useState<TranscriptSummary[]>([]);
  const [activeTab, setActiveTab] = useState<"teams" | "categories" | "panels" | "transcripts">("teams");
  const [busy, setBusy] = useState(false);
  const [routeHash, setRouteHash] = useState(() => window.location.hash || "");
  const [routePath, setRoutePath] = useState(() => window.location.pathname || "/");

  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");
  const [selectedTeamRoleIds, setSelectedTeamRoleIds] = useState<string[]>([]);

  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryDescription, setCategoryDescription] = useState("");
  const [categoryTeamId, setCategoryTeamId] = useState("");
  const [categoryParentChannelId, setCategoryParentChannelId] = useState("");

  const [panelTitle, setPanelTitle] = useState("Need help? Open a ticket");
  const [panelDescription, setPanelDescription] = useState("Select a category below and our team will respond.");
  const [panelChannelId, setPanelChannelId] = useState("");
  const [transcriptChannelId, setTranscriptChannelId] = useState("");
  const [editingPanelId, setEditingPanelId] = useState<string | null>(null);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [activeTranscript, setActiveTranscript] = useState<TranscriptDetail | null>(null);
  const shownErrorMessagesRef = useRef<Set<string>>(new Set());

  const getErrorMessage = (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback;

  const notifyErrorOnce = (message: string) => {
    if (shownErrorMessagesRef.current.has(message)) {
      return;
    }
    shownErrorMessagesRef.current.add(message);
    alert(message);
  };

  const isTransientLoadError = (message: string) => {
    const value = message.toLowerCase();
    return (
      value.includes("discord member lookup failed") ||
      value.includes("discord membership lookup is unavailable") ||
      value.includes("failed to fetch")
    );
  };

  const categoryChannels = useMemo(() => channels.filter((channel) => channel.type === 4), [channels]);
  const textChannels = useMemo(() => channels.filter((channel) => channel.type === 0 || channel.type === 5), [channels]);
  const transcriptTicketId = useMemo(() => {
    const match = routeHash.match(/^#\/transcripts\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  }, [routeHash]);
  const isTermsRoute = useMemo(() => routePath === "/terms" || routeHash === "#/terms", [routePath, routeHash]);

  const load = async () => {
    const me = await apiFetch("/auth/me");
    const currentUser = me.user || null;
    setUser(currentUser);
    if (!currentUser) {
      return;
    }
    if (!currentUser.canAccessDashboard) {
      setTeams([]);
      setCategories([]);
      setPanels([]);
      setChannels([]);
      setRoles([]);
      setSettings({});
      setTranscripts([]);
      return;
    }

    if (currentUser.canManage) {
      const [teamData, categoryData, panelData, channelData, roleData, settingsData, transcriptData] = await Promise.all([
        apiFetch("/teams"),
        apiFetch("/categories"),
        apiFetch("/panels"),
        apiFetch("/discord/channels"),
        apiFetch("/discord/roles"),
        apiFetch("/settings"),
        apiFetch("/transcripts")
      ]);
      setTeams(teamData.teams || []);
      setCategories(categoryData.categories || []);
      setPanels(panelData.panels || []);
      setChannels(channelData.channels || []);
      setRoles(roleData.roles || []);
      const loadedSettings = settingsData.settings || {};
      setSettings(loadedSettings);
      setTranscriptChannelId(loadedSettings.transcriptChannelId || "");
      setTranscripts(transcriptData.transcripts || []);
      return;
    }

    const transcriptData = await apiFetch("/transcripts");
    setTeams([]);
    setCategories([]);
    setPanels([]);
    setChannels([]);
    setRoles([]);
    setSettings({});
    setTranscriptChannelId("");
    setActiveTab("transcripts");
    setTranscripts(transcriptData.transcripts || []);
  };

  useEffect(() => {
    if (isTermsRoute) {
      return;
    }
    let cancelled = false;
    const run = async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await load();
          return;
        } catch (error) {
          if (cancelled) {
            return;
          }
          const message = getErrorMessage(error, "Failed to load dashboard");
          if (attempt < 2 && isTransientLoadError(message)) {
            await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
            continue;
          }
          notifyErrorOnce(message);
          return;
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [isTermsRoute]);

  useEffect(() => {
    const updateRoute = () => {
      setRouteHash(window.location.hash || "");
      setRoutePath(window.location.pathname || "/");
    };
    const onHashChange = () => updateRoute();
    const onPopState = () => updateRoute();
    updateRoute();
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  useEffect(() => {
    if (routeHash === "#/transcripts") {
      setActiveTab("transcripts");
    }
  }, [routeHash]);

  useEffect(() => {
    if (!user || !transcriptTicketId) {
      setActiveTranscript(null);
      return;
    }
    apiFetch(`/transcripts/${transcriptTicketId}`)
      .then((data) => setActiveTranscript((data.transcript || null) as TranscriptDetail | null))
      .catch((error) => {
        notifyErrorOnce(getErrorMessage(error, "Unable to load transcript"));
      });
  }, [user, transcriptTicketId]);

  useEffect(() => {
    if (!user) {
      return;
    }
    const viewingTranscripts = activeTab === "transcripts" || routeHash.startsWith("#/transcripts");
    if (!viewingTranscripts) {
      return;
    }

    const refreshTranscripts = async () => {
      try {
        const transcriptData = await apiFetch("/transcripts");
        setTranscripts(transcriptData.transcripts || []);
      } catch (error) {
        console.warn("[dashboard] transcript auto-refresh failed", error);
      }
    };

    void refreshTranscripts();
    const timer = window.setInterval(() => {
      void refreshTranscripts();
    }, 8000);
    return () => window.clearInterval(timer);
  }, [user, activeTab, routeHash]);

  useEffect(() => {
    if (!user || !transcriptTicketId) {
      return;
    }

    const refreshDetail = async () => {
      try {
        const data = await apiFetch(`/transcripts/${transcriptTicketId}`);
        setActiveTranscript((data.transcript || null) as TranscriptDetail | null);
      } catch (error) {
        console.warn("[dashboard] transcript detail auto-refresh failed", error);
      }
    };

    const timer = window.setInterval(() => {
      void refreshDetail();
    }, 8000);
    return () => window.clearInterval(timer);
  }, [user, transcriptTicketId]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
  };

  const themeToggle = (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );

  const resetTeamForm = () => {
    setEditingTeamId(null);
    setTeamName("");
    setSelectedTeamRoleIds([]);
  };

  const startEditTeam = (team: Team) => {
    setEditingTeamId(team.id);
    setTeamName(team.name);
    setSelectedTeamRoleIds(team.roles.map((role) => role.roleId));
  };

  const saveTeam = async () => {
    const roleIds = selectedTeamRoleIds;
    if (!teamName.trim()) {
      alert("Team name is required.");
      return;
    }
    if (roleIds.length === 0) {
      alert("At least one role is required.");
      return;
    }
    setBusy(true);
    try {
      await apiFetch(editingTeamId ? `/teams/${editingTeamId}` : "/teams", {
        method: editingTeamId ? "PUT" : "POST",
        body: JSON.stringify({
          name: teamName.trim(),
          roleIds
        })
      });
      await load();
      resetTeamForm();
    } catch (error) {
      notifyErrorOnce(getErrorMessage(error, "Unable to save team"));
    } finally {
      setBusy(false);
    }
  };

  const deleteTeam = async (team: Team) => {
    if (!window.confirm(`Delete team "${team.name}"?`)) {
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/teams/${team.id}`, { method: "DELETE" });
      if (editingTeamId === team.id) {
        resetTeamForm();
      }
      await load();
    } catch (error) {
      notifyErrorOnce(getErrorMessage(error, "Unable to delete team"));
    } finally {
      setBusy(false);
    }
  };

  const resetCategoryForm = () => {
    setEditingCategoryId(null);
    setCategoryName("");
    setCategoryDescription("");
    setCategoryTeamId("");
    setCategoryParentChannelId("");
  };

  const startEditCategory = (category: Category) => {
    setEditingCategoryId(category.id);
    setCategoryName(category.name);
    setCategoryDescription(category.description);
    setCategoryTeamId(category.supportTeamId);
    setCategoryParentChannelId(category.parentChannelId || "");
  };

  const saveCategory = async () => {
    if (!categoryName.trim() || !categoryTeamId) {
      alert("Category name and support team are required.");
      return;
    }
    setBusy(true);
    try {
      await apiFetch(editingCategoryId ? `/categories/${editingCategoryId}` : "/categories", {
        method: editingCategoryId ? "PUT" : "POST",
        body: JSON.stringify({
          name: categoryName.trim(),
          description: categoryDescription.trim() || "No description provided",
          supportTeamId: categoryTeamId,
          parentChannelId: categoryParentChannelId || undefined,
          enabled: true,
          sortOrder: 0
        })
      });
      await load();
      resetCategoryForm();
    } catch (error) {
      notifyErrorOnce(getErrorMessage(error, "Unable to save category"));
    } finally {
      setBusy(false);
    }
  };

  const deleteCategory = async (category: Category) => {
    if (!window.confirm(`Delete category "${category.name}"?`)) {
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/categories/${category.id}`, { method: "DELETE" });
      if (editingCategoryId === category.id) {
        resetCategoryForm();
      }
      await load();
    } catch (error) {
      notifyErrorOnce(getErrorMessage(error, "Unable to delete category"));
    } finally {
      setBusy(false);
    }
  };

  const resetPanelForm = () => {
    setEditingPanelId(null);
    setPanelChannelId("");
    setPanelTitle("Need help? Open a ticket");
    setPanelDescription("Select a category below and our team will respond.");
    setSelectedCategoryIds([]);
  };

  const startEditPanel = (panel: Panel) => {
    setEditingPanelId(panel.id);
    setPanelChannelId(panel.channelId);
    setPanelTitle(panel.title);
    setPanelDescription(panel.description);
    setSelectedCategoryIds(panel.categories.filter((category) => category.enabled).map((category) => category.categoryId));
  };

  const savePanel = async () => {
    if (!panelChannelId.trim() || !panelTitle.trim()) {
      alert("Channel and panel title are required.");
      return;
    }
    if (editingPanelId && selectedCategoryIds.length === 0) {
      alert("At least one category is required when editing a panel.");
      return;
    }
    setBusy(true);
    try {
      await apiFetch(editingPanelId ? `/panels/${editingPanelId}` : "/panels", {
        method: editingPanelId ? "PUT" : "POST",
        body: JSON.stringify(
          editingPanelId
            ? {
                channelId: panelChannelId.trim(),
                title: panelTitle.trim(),
                description: panelDescription.trim(),
                categories: selectedCategoryIds.map((id) => ({ id, enabled: true }))
              }
            : {
                channelId: panelChannelId.trim(),
                title: panelTitle.trim(),
                description: panelDescription.trim(),
                categoryIds: selectedCategoryIds
              }
        )
      });
      resetPanelForm();
      await load();
    } catch (error) {
      notifyErrorOnce(getErrorMessage(error, "Unable to save panel"));
    } finally {
      setBusy(false);
    }
  };

  const deletePanel = async (panel: Panel) => {
    if (!window.confirm(`Delete panel "${panel.title}"?`)) {
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/panels/${panel.id}`, { method: "DELETE" });
      if (editingPanelId === panel.id) {
        resetPanelForm();
      }
      await load();
    } catch (error) {
      notifyErrorOnce(getErrorMessage(error, "Unable to delete panel"));
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async () => {
    setBusy(true);
    try {
      const response = await apiFetch("/settings", {
        method: "PUT",
        body: JSON.stringify({
          transcriptChannelId: transcriptChannelId || null
        })
      });
      setSettings(response.settings || {});
      setTranscriptChannelId((response.settings?.transcriptChannelId as string) || "");
      alert("Settings saved.");
    } catch (error) {
      notifyErrorOnce(getErrorMessage(error, "Unable to save settings"));
    } finally {
      setBusy(false);
    }
  };

  const termsPage = (
    <div className="page">
      {themeToggle}
      <header className="hero">
        <div>
          <h1>Terms and Conditions</h1>
          <p>RAIL Ticketing System</p>
        </div>
        <a className="button secondary" href="/">
          Back to Dashboard
        </a>
      </header>

      <section className="card">
        <h2>Acceptance of Terms</h2>
        <p>By using the UKRRP Ticket System Discord bot, dashboard, or related services, you agree to these terms.</p>
        <h2>Data Collected and Stored</h2>
        <p>The system may collect and store the following data to operate ticketing features:</p>
        <ul>
          <li>Discord IDs, usernames, role IDs, guild IDs, and channel IDs</li>
          <li>Ticket metadata such as owner, claimer, category, status, timestamps, and close reason</li>
          <li>Ticket event history such as create, claim, transfer, rename, close, and inactivity events</li>
          <li>Transcript content, message metadata, and attachment URLs</li>
          <li>Media backup linkage such as thread IDs and starter message IDs</li>
          <li>Dashboard session and authentication context</li>
        </ul>
        <h2>Logging</h2>
        <p>Operational logs are collected for reliability and diagnostics. Logs include request metadata and may include IP addresses from request headers such as <strong>cf-connecting-ip</strong> and <strong>x-forwarded-for</strong>.</p>
        <h2>Use of Data</h2>
        <p>Data is used to provide ticket workflows, enforce permissions, generate transcripts, and maintain service health.</p>
        <h2>Retention</h2>
        <p>Data is retained as needed for operations and moderation workflows. Administrative tools may allow transcript cleanup where configured.</p>
        <h2>Changes</h2>
        <p>These terms may be updated. Continued use of the system indicates acceptance of updated terms.</p>
      </section>

      <footer className="brand-footer">{brandingFooter}</footer>
    </div>
  );

  if (isTermsRoute) {
    return termsPage;
  }

  if (!user) {
    return (
      <div className="page">
        {themeToggle}
        <div className="card login-card">
          <h1>{appName}</h1>
          <p>Sign in with Discord to manage tickets and panels.</p>
          <a className="button" href={`${import.meta.env.VITE_API_BASE}/auth/login`}>
            Log in with Discord
          </a>
        </div>
        <a className="button secondary" href="/terms">
          Terms and Conditions
        </a>
        <footer className="brand-footer">{brandingFooter}</footer>
      </div>
    );
  }

  if (user && user.canAccessDashboard === false) {
    return (
      <div className="page">
        {themeToggle}
        <div className="card login-card">
          <h1>{appName}</h1>
          <p>Your account does not have dashboard access for this guild.</p>
          <button
            className="button secondary"
            onClick={() =>
              apiFetch("/auth/logout", { method: "POST" }).then(() => {
                window.location.reload();
              })
            }
          >
            Log out
          </button>
        </div>
        <footer className="brand-footer">{brandingFooter}</footer>
      </div>
    );
  }

  if (transcriptTicketId) {
    const looksLikeHtml = Boolean(activeTranscript?.content?.trim().startsWith("<"));
    const transcriptTitle = formatTicketTitle(activeTranscript?.ticketLabel, transcriptTicketId);
    return (
      <div className="page">
        {themeToggle}
        <header className="hero">
          <div>
            <h1>Transcript {transcriptTitle}</h1>
            <p>Opened by <strong>{activeTranscript?.openedByName || activeTranscript?.openedById || "unknown"}</strong> • Closed by <strong>{activeTranscript?.closedByName || activeTranscript?.closedById || "unknown"}</strong></p>
          </div>
          <a className="button secondary" href="#/transcripts">
            Back to Transcripts
          </a>
        </header>

        <section className="card">
          <div className="meta">Opened: {activeTranscript?.openedAt ? new Date(activeTranscript.openedAt).toLocaleString() : "-"}</div>
          <div className="meta">Closed: {activeTranscript?.closedAt ? new Date(activeTranscript.closedAt).toLocaleString() : "-"}</div>
          <div className="meta">Reason: {activeTranscript?.reason || "No reason provided"}</div>
          {!activeTranscript ? (
            <p className="muted">Loading transcript...</p>
          ) : looksLikeHtml ? (
            <iframe className="transcript-frame" title={`Transcript ${transcriptTicketId}`} srcDoc={activeTranscript.content} />
          ) : (
            <pre className="transcript-pre">{activeTranscript.content}</pre>
          )}
        </section>
        <footer className="brand-footer">{brandingFooter}</footer>
      </div>
    );
  }

  return (
    <div className="page">
      {themeToggle}
      <header className="hero">
        <div>
          <h1>{appName}</h1>
          <p>{user.canManage ? "Manage teams, categories, and ticket panels from one clean workspace." : "View ticket transcripts."}</p>
        </div>
        <button
          className="button secondary"
          onClick={() =>
            apiFetch("/auth/logout", { method: "POST" }).then(() => {
              window.location.reload();
            })
          }
        >
          Log out
        </button>
      </header>

      <div className="tabs">
        {user.canManage && (
          <>
            <button className={`tab ${activeTab === "teams" ? "active" : ""}`} onClick={() => { setActiveTab("teams"); window.location.hash = "#/"; }}>Teams ({teams.length})</button>
            <button className={`tab ${activeTab === "categories" ? "active" : ""}`} onClick={() => { setActiveTab("categories"); window.location.hash = "#/"; }}>Categories ({categories.length})</button>
            <button className={`tab ${activeTab === "panels" ? "active" : ""}`} onClick={() => { setActiveTab("panels"); window.location.hash = "#/"; }}>Panels ({panels.length})</button>
          </>
        )}
        <button className={`tab ${activeTab === "transcripts" ? "active" : ""}`} onClick={() => { setActiveTab("transcripts"); window.location.hash = "#/transcripts"; }}>Transcripts ({transcripts.length})</button>
      </div>

      {user.canManage && activeTab === "teams" && (
        <section className="grid">
          <div className="card">
            <h2>{editingTeamId ? "Edit Team" : "Create Team"}</h2>
            <label>
              Team Name
              <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="e.g. Support Staff" />
            </label>
            <label>
              Team Roles (select one or more)
              <div className="role-picker">
                {roles.length === 0 ? (
                  <span className="muted">No roles found.</span>
                ) : (
                  roles.map((role) => {
                    const checked = selectedTeamRoleIds.includes(role.id);
                    return (
                      <button
                        key={role.id}
                        type="button"
                        className={checked ? "role-item checked" : "role-item"}
                        onClick={() => {
                          setSelectedTeamRoleIds((current) =>
                            current.includes(role.id)
                              ? current.filter((entry) => entry !== role.id)
                              : [...current, role.id]
                          );
                        }}
                      >
                        <span className={checked ? "checkbox checked" : "checkbox"}>{checked ? "✓" : ""}</span>
                        <span className="role-name" style={role.colorHex ? { color: role.colorHex } : undefined}>{role.name}</span>
                      </button>
                    );
                  })
                )}
              </div>
              <span className="muted">Selected: {selectedTeamRoleIds.length}</span>
            </label>
            <div className="actions">
              <button className="button" onClick={saveTeam} disabled={busy}>{editingTeamId ? "Save Team" : "Create Team"}</button>
              {editingTeamId && (
                <button className="button secondary" onClick={resetTeamForm} disabled={busy}>
                  Cancel
                </button>
              )}
            </div>
          </div>

          <div className="card">
            <h2>Teams</h2>
            {teams.length === 0 ? (
              <p className="muted">No teams yet.</p>
            ) : (
              <div className="list">
                {teams.map((team) => (
                  <div key={team.id} className="item">
                    <div>
                      <h3>{team.name}</h3>
                      <div className="meta">Roles: {team.roles.length}</div>
                    </div>
                    <div className="actions">
                      <button className="button secondary" onClick={() => startEditTeam(team)} disabled={busy}>Edit</button>
                      <button className="button danger" onClick={() => deleteTeam(team)} disabled={busy}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {user.canManage && activeTab === "categories" && (
        <section className="grid">
          <div className="card">
            <h2>{editingCategoryId ? "Edit Category" : "Create Category"}</h2>
            <label>
              Name
              <input value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="e.g. Internal Affairs" />
            </label>
            <label>
              Description
              <textarea
                className="description-textarea"
                value={categoryDescription}
                onChange={(e) => setCategoryDescription(e.target.value)}
                placeholder="Add a detailed description"
              />
            </label>
            <label>
              Support Team
              <select value={categoryTeamId} onChange={(e) => setCategoryTeamId(e.target.value)}>
                <option value="">Select team</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Parent Channel (optional)
              <select value={categoryParentChannelId} onChange={(e) => setCategoryParentChannelId(e.target.value)}>
                <option value="">None</option>
                {categoryChannels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="actions">
              <button className="button" onClick={saveCategory} disabled={busy}>{editingCategoryId ? "Save Category" : "Create Category"}</button>
              {editingCategoryId && (
                <button className="button secondary" onClick={resetCategoryForm} disabled={busy}>
                  Cancel
                </button>
              )}
            </div>
          </div>

          <div className="card">
            <h2>Categories</h2>
            {categories.length === 0 ? (
              <p className="muted">No categories yet.</p>
            ) : (
              <div className="list">
                {categories.map((category) => (
                  <div key={category.id} className="item">
                    <div>
                      <h3>{category.name}</h3>
                      <p className="multiline-text">{renderDiscordEmojiText(category.description)}</p>
                      <div className="meta">{teams.find((t) => t.id === category.supportTeamId)?.name || "Unknown Team"}</div>
                    </div>
                    <div className="actions">
                      <button className="button secondary" onClick={() => startEditCategory(category)} disabled={busy}>Edit</button>
                      <button className="button danger" onClick={() => deleteCategory(category)} disabled={busy}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {user.canManage && activeTab === "panels" && (
        <section className="grid">
          <div className="card">
            <h2>{editingPanelId ? "Edit Panel" : "Create Panel"}</h2>
            <label>
              Channel
              <select value={panelChannelId} onChange={(e) => setPanelChannelId(e.target.value)}>
                <option value="">Select text channel</option>
                {textChannels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    #{channel.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Title
              <input value={panelTitle} onChange={(e) => setPanelTitle(e.target.value)} />
            </label>
            <label>
              Description
              <textarea className="description-textarea" value={panelDescription} onChange={(e) => setPanelDescription(e.target.value)} />
            </label>
            <label>
              Categories
              <div className="pill-row">
                {categories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    className={selectedCategoryIds.includes(category.id) ? "pill active" : "pill"}
                    onClick={() => {
                      setSelectedCategoryIds((current) =>
                        current.includes(category.id)
                          ? current.filter((id) => id !== category.id)
                          : [...current, category.id]
                      );
                    }}
                  >
                    {category.name}
                  </button>
                ))}
              </div>
            </label>
            <label>
              Transcript Channel
              <select value={transcriptChannelId} onChange={(e) => setTranscriptChannelId(e.target.value)}>
                <option value="">Use ticket channel</option>
                {textChannels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    #{channel.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="button secondary" onClick={saveSettings} disabled={busy}>
              Save Settings
            </button>
            <p className="muted">
              Saved transcript channel: {settings.transcriptChannelId ? `#${textChannels.find((channel) => channel.id === settings.transcriptChannelId)?.name || settings.transcriptChannelId}` : "ticket channel"}
            </p>
            <div className="actions">
              <button className="button" onClick={savePanel} disabled={busy}>{editingPanelId ? "Save Panel" : "Create Panel"}</button>
              {editingPanelId && (
                <button className="button secondary" onClick={resetPanelForm} disabled={busy}>
                  Cancel
                </button>
              )}
            </div>
          </div>

          <div className="card">
            <h2>Panels</h2>
            {panels.length === 0 ? (
              <p className="muted">No panels yet.</p>
            ) : (
              <div className="list">
                {panels.map((panel) => (
                  <div key={panel.id} className="item">
                    <div>
                      <h3>{renderDiscordEmojiText(panel.title)}</h3>
                      <p className="multiline-text">{renderDiscordEmojiText(panel.description)}</p>
                      <div className="meta">
                        Channel {textChannels.find((channel) => channel.id === panel.channelId)?.name || panel.channelId}
                      </div>
                      <div className="meta">
                        Categories: {panel.categories.map((category) => category.category?.name || categories.find((entry) => entry.id === category.categoryId)?.name || "Unknown").join(", ") || "None"}
                      </div>
                    </div>
                    <div className="actions">
                      <button className="button secondary" onClick={() => startEditPanel(panel)} disabled={busy}>Edit</button>
                      <button
                        className="button secondary"
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await apiFetch(`/panels/${panel.id}/publish`, { method: "POST" });
                            await load();
                            alert("Panel published.");
                          } catch (error) {
                            notifyErrorOnce(getErrorMessage(error, "Unable to publish panel"));
                          } finally {
                            setBusy(false);
                          }
                        }}
                        disabled={busy}
                      >
                        Publish
                      </button>
                      <button className="button danger" onClick={() => deletePanel(panel)} disabled={busy}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {activeTab === "transcripts" && (
        <section className="card">
          <h2>Transcripts</h2>
          {user?.isSuperuser && (
            <div className="actions">
              <button
                className="button danger"
                disabled={busy}
                onClick={async () => {
                  if (!window.confirm("Force close ALL open tickets for this guild?")) {
                    return;
                  }
                  setBusy(true);
                  try {
                    const response = await apiFetch("/transcripts/force-close-open", { method: "POST" });
                    alert(`Force close complete. Closed: ${response.closedCount || 0}, Failed: ${response.failedCount || 0}`);
                    await load();
                  } catch (error) {
                    notifyErrorOnce(getErrorMessage(error, "Unable to force close tickets"));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Force Close Open Tickets
              </button>
              <button
                className="button danger"
                disabled={busy || transcripts.length === 0}
                onClick={async () => {
                  if (!window.confirm("Delete all transcripts for this guild? This cannot be undone.")) {
                    return;
                  }
                  setBusy(true);
                  try {
                    await apiFetch("/transcripts", { method: "DELETE" });
                    await load();
                  } catch (error) {
                    notifyErrorOnce(getErrorMessage(error, "Unable to delete all transcripts"));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Delete All Transcripts
              </button>
            </div>
          )}
          {transcripts.length === 0 ? (
            <p className="muted">No transcripts yet.</p>
          ) : (
            <div className="list">
              {transcripts.map((entry) => (
                <div key={entry.ticketId} className="item">
                  <div>
                    <h3>{formatTicketTitle(entry.ticketLabel, entry.ticketId)}</h3>
                    <div className="meta">Opened by: {entry.openedByName || entry.openedById}</div>
                    <div className="meta">Closed by: {entry.closedByName || entry.closedById || "unknown"}</div>
                    <div className="meta">Reason: {entry.reason || "No reason provided"}</div>
                    <div className="meta">Opened: {entry.openedAt ? new Date(entry.openedAt).toLocaleString() : "-"}</div>
                    <div className="meta">Closed: {entry.closedAt ? new Date(entry.closedAt).toLocaleString() : "-"}</div>
                  </div>
                  <a
                    className="button secondary"
                    href={`#/transcripts/${encodeURIComponent(entry.ticketId)}`}
                  >
                    Open Transcript
                  </a>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      <footer className="brand-footer">{brandingFooter}</footer>
    </div>
  );
};
