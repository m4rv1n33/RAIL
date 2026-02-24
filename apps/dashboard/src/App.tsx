import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "./api.js";

type User = { id: string; isSuperuser?: boolean };
type Team = {
  id: string;
  name: string;
  roles: { roleId: string }[];
};
type DiscordRole = { id: string; name: string; position: number; managed?: boolean };
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
type GuildSettings = { transcriptChannelId?: string };
type TranscriptSummary = {
  ticketId: string;
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

export const App = () => {
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

  const categoryChannels = useMemo(() => channels.filter((channel) => channel.type === 4), [channels]);
  const textChannels = useMemo(() => channels.filter((channel) => channel.type === 0 || channel.type === 5), [channels]);
  const transcriptTicketId = useMemo(() => {
    const match = routeHash.match(/^#\/transcripts\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  }, [routeHash]);

  const load = async () => {
    const me = await apiFetch("/auth/me");
    setUser(me.user || null);
    if (!me.user) {
      return;
    }
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
  };

  useEffect(() => {
    load().catch((error) => {
      alert(error instanceof Error ? error.message : "Failed to load dashboard");
    });
  }, []);

  useEffect(() => {
    const onHashChange = () => setRouteHash(window.location.hash || "");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
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
        alert(error instanceof Error ? error.message : "Unable to load transcript");
      });
  }, [user, transcriptTicketId]);

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
      alert(error instanceof Error ? error.message : "Unable to save team");
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
      alert(error instanceof Error ? error.message : "Unable to delete team");
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
      alert(error instanceof Error ? error.message : "Unable to save category");
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
      alert(error instanceof Error ? error.message : "Unable to delete category");
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
      alert(error instanceof Error ? error.message : "Unable to save panel");
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
      alert(error instanceof Error ? error.message : "Unable to delete panel");
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
      alert(error instanceof Error ? error.message : "Unable to save settings");
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <div className="page">
        <div className="card login-card">
          <h1>Rail Dashboard</h1>
          <p>Sign in with Discord to manage tickets and panels.</p>
          <a className="button" href={`${import.meta.env.VITE_API_BASE}/auth/login`}>
            Log in with Discord
          </a>
        </div>
      </div>
    );
  }

  if (transcriptTicketId) {
    const looksLikeHtml = Boolean(activeTranscript?.content?.trim().startsWith("<"));
    return (
      <div className="page">
        <header className="hero">
          <div>
            <h1>Transcript {transcriptTicketId}</h1>
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
      </div>
    );
  }

  return (
    <div className="page">
      <header className="hero">
        <div>
          <h1>Rail Dashboard</h1>
          <p>Manage teams, categories, and ticket panels from one clean workspace.</p>
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
        <button className={`tab ${activeTab === "teams" ? "active" : ""}`} onClick={() => { setActiveTab("teams"); window.location.hash = "#/"; }}>Teams ({teams.length})</button>
        <button className={`tab ${activeTab === "categories" ? "active" : ""}`} onClick={() => { setActiveTab("categories"); window.location.hash = "#/"; }}>Categories ({categories.length})</button>
        <button className={`tab ${activeTab === "panels" ? "active" : ""}`} onClick={() => { setActiveTab("panels"); window.location.hash = "#/"; }}>Panels ({panels.length})</button>
        <button className={`tab ${activeTab === "transcripts" ? "active" : ""}`} onClick={() => { setActiveTab("transcripts"); window.location.hash = "#/transcripts"; }}>Transcripts ({transcripts.length})</button>
      </div>

      {activeTab === "teams" && (
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
                        <span>@{role.name}</span>
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

      {activeTab === "categories" && (
        <section className="grid">
          <div className="card">
            <h2>{editingCategoryId ? "Edit Category" : "Create Category"}</h2>
            <label>
              Name
              <input value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="e.g. Billing" />
            </label>
            <label>
              Description
              <textarea
                value={categoryDescription}
                onChange={(e) => setCategoryDescription(e.target.value)}
                placeholder="Add a detailed description (supports line breaks)"
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
                      <p className="multiline-text">{category.description}</p>
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

      {activeTab === "panels" && (
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
              <textarea value={panelDescription} onChange={(e) => setPanelDescription(e.target.value)} />
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
                      <h3>{panel.title}</h3>
                      <p>{panel.description}</p>
                      <div className="meta">
                        Channel {textChannels.find((channel) => channel.id === panel.channelId)?.name || panel.channelId}
                      </div>
                      <div className="meta">
                        Categories: {panel.categories.map((category) => category.category?.name || categories.find((entry) => entry.id === category.categoryId)?.name || "Unknown").join(", ") || "None"}
                      </div>
                    </div>
                    <div className="actions">
                      <button className="button secondary" onClick={() => startEditPanel(panel)} disabled={busy}>Edit</button>
                      <button className="button secondary" onClick={() => apiFetch(`/panels/${panel.id}/publish`, { method: "POST" }).then(() => load())} disabled={busy}>Publish</button>
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
                    alert(error instanceof Error ? error.message : "Unable to force close tickets");
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
                    alert(error instanceof Error ? error.message : "Unable to delete all transcripts");
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
                    <h3>Ticket {entry.ticketId}</h3>
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
    </div>
  );
};
