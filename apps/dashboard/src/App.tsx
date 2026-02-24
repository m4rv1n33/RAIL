import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "./api.js";

type User = { id: string };
type Team = {
  id: string;
  name: string;
  isManagement: boolean;
  escalationTeamId?: string | null;
  roles: { roleId: string }[];
};
type Category = {
  id: string;
  name: string;
  description: string;
  example: string;
  supportTeamId: string;
  enabled: boolean;
  parentChannelId?: string | null;
};
type Panel = { id: string; channelId: string; title: string; description: string; isActive: boolean };

const parseRoleIds = (value: string) =>
  value
    .split(/[\n,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

export const App = () => {
  const [user, setUser] = useState<User | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [activeTab, setActiveTab] = useState<"teams" | "categories" | "panels">("teams");
  const [busy, setBusy] = useState(false);

  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");
  const [isManagement, setIsManagement] = useState(false);
  const [teamRoleIds, setTeamRoleIds] = useState("");
  const [escalationTeamId, setEscalationTeamId] = useState("");

  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryDescription, setCategoryDescription] = useState("");
  const [categoryExample, setCategoryExample] = useState("");
  const [categoryTeamId, setCategoryTeamId] = useState("");
  const [categoryParentChannelId, setCategoryParentChannelId] = useState("");

  const [panelTitle, setPanelTitle] = useState("Need help? Open a ticket");
  const [panelDescription, setPanelDescription] = useState("Select a category below and our team will respond.");
  const [panelChannelId, setPanelChannelId] = useState("");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);

  const managementTeams = useMemo(() => teams.filter((team) => team.isManagement), [teams]);

  const load = async () => {
    const me = await apiFetch("/auth/me");
    setUser(me.user || null);
    if (!me.user) {
      return;
    }
    const [teamData, categoryData, panelData] = await Promise.all([
      apiFetch("/teams"),
      apiFetch("/categories"),
      apiFetch("/panels")
    ]);
    setTeams(teamData.teams || []);
    setCategories(categoryData.categories || []);
    setPanels(panelData.panels || []);
  };

  useEffect(() => {
    load().catch((error) => {
      alert(error instanceof Error ? error.message : "Failed to load dashboard");
    });
  }, []);

  const resetTeamForm = () => {
    setEditingTeamId(null);
    setTeamName("");
    setIsManagement(false);
    setTeamRoleIds("");
    setEscalationTeamId("");
  };

  const startEditTeam = (team: Team) => {
    setEditingTeamId(team.id);
    setTeamName(team.name);
    setIsManagement(team.isManagement);
    setTeamRoleIds(team.roles.map((role) => role.roleId).join("\n"));
    setEscalationTeamId(team.escalationTeamId || "");
  };

  const saveTeam = async () => {
    const roleIds = parseRoleIds(teamRoleIds);
    if (!teamName.trim()) {
      alert("Team name is required.");
      return;
    }
    if (roleIds.length === 0) {
      alert("At least one role ID is required.");
      return;
    }
    setBusy(true);
    try {
      await apiFetch(editingTeamId ? `/teams/${editingTeamId}` : "/teams", {
        method: editingTeamId ? "PUT" : "POST",
        body: JSON.stringify({
          name: teamName.trim(),
          isManagement,
          escalationTeamId: escalationTeamId || undefined,
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
    setCategoryExample("");
    setCategoryTeamId("");
    setCategoryParentChannelId("");
  };

  const startEditCategory = (category: Category) => {
    setEditingCategoryId(category.id);
    setCategoryName(category.name);
    setCategoryDescription(category.description);
    setCategoryExample(category.example);
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
          example: categoryExample.trim() || "No example provided",
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

  const createPanel = async () => {
    if (!panelChannelId.trim() || !panelTitle.trim()) {
      alert("Channel ID and panel title are required.");
      return;
    }
    setBusy(true);
    try {
      await apiFetch("/panels", {
        method: "POST",
        body: JSON.stringify({
          channelId: panelChannelId.trim(),
          title: panelTitle.trim(),
          description: panelDescription.trim(),
          categoryIds: selectedCategoryIds
        })
      });
      setPanelChannelId("");
      setPanelTitle("Need help? Open a ticket");
      setPanelDescription("Select a category below and our team will respond.");
      setSelectedCategoryIds([]);
      await load();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Unable to create panel");
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
        <button className={`tab ${activeTab === "teams" ? "active" : ""}`} onClick={() => setActiveTab("teams")}>Teams ({teams.length})</button>
        <button className={`tab ${activeTab === "categories" ? "active" : ""}`} onClick={() => setActiveTab("categories")}>Categories ({categories.length})</button>
        <button className={`tab ${activeTab === "panels" ? "active" : ""}`} onClick={() => setActiveTab("panels")}>Panels ({panels.length})</button>
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
              Role IDs (one per line)
              <textarea
                value={teamRoleIds}
                onChange={(e) => setTeamRoleIds(e.target.value)}
                placeholder="123456789012345678"
              />
            </label>
            <label className="inline">
              <input type="checkbox" checked={isManagement} onChange={(e) => setIsManagement(e.target.checked)} />
              Management Team
            </label>
            <label>
              Escalation Team
              <select value={escalationTeamId} onChange={(e) => setEscalationTeamId(e.target.value)}>
                <option value="">None</option>
                {managementTeams
                  .filter((team) => team.id !== editingTeamId)
                  .map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
              </select>
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
                      <div className="meta">
                        {team.isManagement && <span className="badge">Management</span>}
                        {team.escalationTeamId && (
                          <span className="badge">Escalates to {teams.find((t) => t.id === team.escalationTeamId)?.name || "Unknown"}</span>
                        )}
                      </div>
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
              <input
                value={categoryDescription}
                onChange={(e) => setCategoryDescription(e.target.value)}
                placeholder="Short description"
              />
            </label>
            <label>
              Example
              <input value={categoryExample} onChange={(e) => setCategoryExample(e.target.value)} placeholder="e.g. I can't access my account" />
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
              <input
                value={categoryParentChannelId}
                onChange={(e) => setCategoryParentChannelId(e.target.value)}
                placeholder="Discord category/channel ID"
              />
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
                      <p>{category.description}</p>
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
            <h2>Create Panel</h2>
            <label>
              Channel ID
              <input value={panelChannelId} onChange={(e) => setPanelChannelId(e.target.value)} placeholder="Discord text channel ID" />
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
            <button className="button" onClick={createPanel} disabled={busy}>Create Panel</button>
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
                      <div className="meta">Channel {panel.channelId}</div>
                    </div>
                    <button
                      className="button secondary"
                      onClick={() => apiFetch(`/panels/${panel.id}/publish`, { method: "POST" }).then(() => load())}
                      disabled={busy}
                    >
                      Publish
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
};
