import React, { useState, useEffect } from 'react';

export default function App() {
  const [user, setUser] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [errorMsg, setErrorMsg] = useState('');
  
  // Dynamic navigation inside campaigns
  const [selectedCampaignId, setSelectedCampaignId] = useState(null);
  const [isCreatingCampaign, setIsCreatingCampaign] = useState(false);

  // Expose URL queries (like ?error=unauthorized)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err === 'unauthorized') {
      setErrorMsg('У вас нет прав администратора в Discord для доступа к панели.');
    } else if (err === 'oauth_failed') {
      setErrorMsg('Авторизация через Discord завершилась с ошибкой.');
    } else if (err === 'server_error') {
      setErrorMsg('Ошибка на стороне сервера авторизации.');
    }
  }, []);

  // Fetch logged in user
  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.json())
      .then(data => {
        if (data.loggedIn) {
          setUser(data.user);
        }
        setLoadingUser(false);
      })
      .catch(() => setLoadingUser(false));
  }, []);

  const handleLogout = () => {
    fetch('/api/auth/logout', { method: 'POST' })
      .then(res => res.json())
      .then(() => {
        setUser(null);
        setActiveTab('dashboard');
      });
  };

  if (loadingUser) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0d0e12', color: '#949ba4' }}>
        <p>Загрузка панели управления...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="login-container">
        <div className="login-card animate-fade">
          <div className="login-logo">T</div>
          <h1 className="login-title">Troxill Admin</h1>
          <p className="login-subtitle">Управление DM-кампаниями и рассылками</p>
          {errorMsg && <div className="alert alert-danger">{errorMsg}</div>}
          <a href="/api/auth/login" className="btn btn-primary" style={{ width: '100%', textDecoration: 'none' }}>
            Войти через Discord
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <nav className="sidebar">
        <div className="brand">
          <div className="brand-icon">T</div>
          <span className="brand-name">Troxill Bot</span>
        </div>
        <ul className="nav-links">
          <li className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => { setActiveTab('dashboard'); setSelectedCampaignId(null); setIsCreatingCampaign(false); }}>
            Dashboard
          </li>
          <li className={`nav-item ${activeTab === 'campaigns' ? 'active' : ''}`} onClick={() => { setActiveTab('campaigns'); setSelectedCampaignId(null); setIsCreatingCampaign(false); }}>
            Кампании
          </li>
          <li className={`nav-item ${activeTab === 'exclusions' ? 'active' : ''}`} onClick={() => { setActiveTab('exclusions'); setSelectedCampaignId(null); setIsCreatingCampaign(false); }}>
            Исключения
          </li>
          <li className={`nav-item ${activeTab === 'audit' ? 'active' : ''}`} onClick={() => { setActiveTab('audit'); setSelectedCampaignId(null); setIsCreatingCampaign(false); }}>
            Аудит лог
          </li>
        </ul>
        <div className="sidebar-footer">
          {user.avatar ? (
            <img src={`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`} className="user-avatar" alt="" />
          ) : (
            <div className="user-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', background: '#35393e' }}>
              {user.username[0].toUpperCase()}
            </div>
          )}
          <div className="user-info">
            <div className="user-name">{user.globalName}</div>
            <div className="user-role">Администратор</div>
          </div>
          <button className="logout-btn" onClick={handleLogout} title="Выйти">
            🚪
          </button>
        </div>
      </nav>
      <main className="main-content">
        {activeTab === 'dashboard' && <DashboardView />}
        {activeTab === 'campaigns' && !selectedCampaignId && !isCreatingCampaign && (
          <CampaignsListView 
            onSelectCampaign={setSelectedCampaignId} 
            onCreateNew={() => setIsCreatingCampaign(true)} 
          />
        )}
        {activeTab === 'campaigns' && selectedCampaignId && (
          <CampaignDetailsView 
            campaignId={selectedCampaignId} 
            onBack={() => setSelectedCampaignId(null)} 
          />
        )}
        {activeTab === 'campaigns' && isCreatingCampaign && (
          <CampaignBuilderView 
            onBack={() => setIsCreatingCampaign(false)} 
            onCreated={(id) => { setIsCreatingCampaign(false); setSelectedCampaignId(id); }} 
          />
        )}
        {activeTab === 'exclusions' && <ExclusionsView />}
        {activeTab === 'audit' && <AuditView />}
      </main>
    </div>
  );
}

// -------------------------------------------------------------
// DASHBOARD VIEW
// -------------------------------------------------------------
function DashboardView() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = () => {
    fetch('/api/dashboard')
      .then(res => res.json())
      .then(data => {
        setStats(data);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const handleKillSwitch = (active) => {
    fetch('/api/killswitch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active })
    })
      .then(res => res.json())
      .then(() => fetchStats());
  };

  if (loading) return <div>Загрузка статистики...</div>;

  return (
    <div className="animate-fade">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '6px' }}>Панель управления</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Краткая сводка о состоянии бота и кампаний</p>
        </div>
        <div>
          {stats.killSwitchActive ? (
            <button className="btn btn-success" onClick={() => handleKillSwitch(false)}>
              🟢 Включить воркеры рассылок
            </button>
          ) : (
            <button className="btn btn-danger" onClick={() => handleKillSwitch(true)}>
              🛑 Глобальный выключатель (Kill Switch)
            </button>
          )}
        </div>
      </div>

      <div className="grid-cols-4">
        <div className="card">
          <div className="card-title">Статус бота</div>
          <div className="card-value" style={{ color: stats.botStatus === 'Online' ? 'var(--success-color)' : 'var(--danger-color)' }}>
            {stats.botStatus}
          </div>
          <div className="card-subtext">Discord WebSocket Client</div>
        </div>
        <div className="card">
          <div className="card-title">Сервер Discord</div>
          <div className="card-value">{stats.guild.name}</div>
          <div className="card-subtext">ID: {stats.guild.id}</div>
        </div>
        <div className="card">
          <div className="card-title">Участников на сервере</div>
          <div className="card-value">{stats.guild.memberCount}</div>
          <div className="card-subtext">Всего в кэше/API</div>
        </div>
        <div className="card">
          <div className="card-title">Всего кампаний</div>
          <div className="card-value">{stats.campaigns.total}</div>
          <div className="card-subtext">{stats.campaigns.active} активно выполняется</div>
        </div>
      </div>

      <h2 style={{ fontSize: '1.4rem', marginBottom: '20px', fontFamily: 'var(--font-heading)' }}>Последние действия администраторов</h2>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Администратор ID</th>
              <th>Действие</th>
              <th>Цель</th>
              <th>Детали</th>
              <th>Время</th>
            </tr>
          </thead>
          <tbody>
            {stats.auditLogs.map((log) => (
              <tr key={log.id}>
                <td><span className="meta-code">{log.admin_discord_id}</span></td>
                <td><span className="badge badge-draft" style={{ background: '#20222e' }}>{log.action}</span></td>
                <td>{log.target || '—'}</td>
                <td>
                  {log.metadata ? (
                    <span className="meta-code">{JSON.stringify(log.metadata)}</span>
                  ) : '—'}
                </td>
                <td>{new Date(log.timestamp).toLocaleString()}</td>
              </tr>
            ))}
            {stats.auditLogs.length === 0 && (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Логи отсутствуют.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// CAMPAIGNS LIST VIEW
// -------------------------------------------------------------
function CampaignsListView({ onSelectCampaign, onCreateNew }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/campaigns')
      .then(res => res.json())
      .then(data => {
        setCampaigns(data);
        setLoading(false);
      });
  }, []);

  const handleDelete = (e, id) => {
    e.stopPropagation(); // Avoid triggering details select
    if (!confirm('Вы действительно хотите удалить эту кампанию?')) return;

    fetch(`/api/campaigns/${id}`, { method: 'DELETE' })
      .then(res => res.json())
      .then(() => {
        setCampaigns(campaigns.filter(c => c.id !== id));
      });
  };

  if (loading) return <div>Загрузка кампаний...</div>;

  return (
    <div className="animate-fade">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '6px' }}>Кампании рассылок</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Создавайте новые уведомления и контролируйте их отправку</p>
        </div>
        <button className="btn btn-primary" onClick={onCreateNew}>
          ➕ Создать кампанию
        </button>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Название</th>
              <th>Статус</th>
              <th>Прогресс</th>
              <th>Создатель</th>
              <th>Создано</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => {
              const processed = (c.sent_count || 0) + (c.dm_closed_count || 0) + (c.failed_permanent_count || 0) + (c.failed_temporary_count || 0);
              const total = c.total_recipients || 0;
              const percent = total > 0 ? Math.round((processed / total) * 100) : 0;

              return (
                <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => onSelectCampaign(c.id)}>
                  <td>{c.id}</td>
                  <td style={{ fontWeight: '600' }}>{c.name}</td>
                  <td>
                    <span className={`badge badge-${c.status.toLowerCase().split('_')[0]}`}>
                      {c.status}
                    </span>
                  </td>
                  <td>
                    {total > 0 ? (
                      <div style={{ width: '120px' }}>
                        <div style={{ fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between' }}>
                          <span>{percent}%</span>
                          <span>{processed}/{total}</span>
                        </div>
                        <div className="progress-bar-container" style={{ margin: '4px 0 0 0', height: '4px' }}>
                          <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
                        </div>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-secondary)' }}>Черновик (нет получателей)</span>
                    )}
                  </td>
                  <td><span className="meta-code">{c.created_by}</span></td>
                  <td>{new Date(c.created_at).toLocaleDateString()}</td>
                  <td>
                    <button className="btn btn-danger" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={(e) => handleDelete(e, c.id)}>
                      Удалить
                    </button>
                  </td>
                </tr>
              );
            })}
            {campaigns.length === 0 && (
              <tr>
                <td colSpan="7" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Кампаний пока нет. Создайте первую!</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// CAMPAIGN BUILDER VIEW (Wizard)
// -------------------------------------------------------------
function CampaignBuilderView({ onBack, onCreated }) {
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [embedTitle, setEmbedTitle] = useState('');
  const [embedDesc, setEmbedDesc] = useState('');
  const [embedImage, setEmbedImage] = useState('');
  const [embedFooter, setEmbedFooter] = useState('');

  // Link Buttons list
  const [buttons, setButtons] = useState([]);
  
  // Filter settings
  const [excludeUserIds, setExcludeUserIds] = useState('');
  const [excludeRoleIds, setExcludeRoleIds] = useState('');
  const [excludeOwner, setExcludeOwner] = useState(true);

  // Settings
  const [waveSize, setWaveSize] = useState(50);
  const [delayMs, setDelayMs] = useState(2000);
  const [isContinuous, setIsContinuous] = useState(false);

  // Preview & Tests states
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [testUserIds, setTestUserIds] = useState('');
  const [testResults, setTestResults] = useState(null);
  const [testLoading, setTestLoading] = useState(false);
  const [error, setError] = useState('');

  const handleAddButton = () => {
    if (buttons.length >= 5) return;
    setButtons([...buttons, { label: '', url: '' }]);
  };

  const handleRemoveButton = (index) => {
    setButtons(buttons.filter((_, i) => i !== index));
  };

  const handleButtonChange = (index, field, value) => {
    const updated = [...buttons];
    updated[index][field] = value;
    setButtons(updated);
  };

  const getPayload = () => {
    return {
      name,
      messageConfig: {
        content,
        embed: {
          title: embedTitle,
          description: embedDesc,
          image: embedImage,
          footer: embedFooter
        },
        buttons: buttons.filter(b => b.label && b.url)
      },
      campaignSettings: {
        waveSize: Number(waveSize),
        delayMs: Number(delayMs),
        isContinuous: !!isContinuous,
        filters: {
          excludeOwner,
          excludeUserIds,
          excludeRoleIds
        }
      }
    };
  };

  const handlePreview = () => {
    setPreviewLoading(true);
    setError('');
    fetch('/api/audience/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getPayload().campaignSettings)
    })
      .then(res => {
        if (!res.ok) throw new Error('Ошибка фетча превью аудитории');
        return res.json();
      })
      .then(data => {
        setPreview(data);
        setPreviewLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setPreviewLoading(false);
      });
  };

  const handleTestSend = () => {
    if (!testUserIds.trim()) {
      alert('Укажите Discord User ID тестовых получателей');
      return;
    }
    setTestLoading(true);
    setTestResults(null);
    fetch('/api/test-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messageConfig: getPayload().messageConfig,
        testUserIds: testUserIds.split(',').map(id => id.trim()).filter(Boolean)
      })
    })
      .then(res => res.json())
      .then(data => {
        setTestResults(data);
        setTestLoading(false);
      })
      .catch(() => setTestLoading(false));
  };

  const handleCreate = () => {
    if (!name.trim()) {
      alert('Введите название кампании');
      return;
    }
    fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getPayload())
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          onCreated(data.id);
        } else {
          alert('Ошибка создания: ' + data.error);
        }
      });
  };

  return (
    <div className="animate-fade" style={{ maxWidth: '900px' }}>
      <div style={{ display: 'flex', gap: '20px', alignItems: 'center', marginBottom: '32px' }}>
        <button className="btn btn-secondary" onClick={onBack}>← Назад</button>
        <h1 style={{ fontSize: '2rem' }}>Создать новую кампанию</h1>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '30px', marginBottom: '40px' }}>
        
        {/* SECTION 1: MAIN INFO */}
        <div>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>1. Основные параметры</h3>
          <div className="form-group">
            <label className="form-label">Название кампании</label>
            <input className="form-control" type="text" placeholder="Уведомление о технических работах" value={name} onChange={e => setName(e.target.value)} />
          </div>
        </div>

        {/* SECTION 2: MESSAGE BUILDER */}
        <div>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>2. Конструктор сообщения DM</h3>
          <div className="form-group">
            <label className="form-label">Основной текст сообщения (персонализация: {`{displayName}`}, {`{username}`})</label>
            <textarea className="form-control" placeholder="Привет, {displayName}! Бот возобновляет работу..." value={content} onChange={e => setContent(e.target.value)} />
          </div>

          <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px dashed var(--border-color)', padding: '16px', borderRadius: 'var(--radius-md)', marginBottom: '20px' }}>
            <h4 style={{ fontSize: '1rem', marginBottom: '12px' }}>Настройка Embed</h4>
            <div className="form-group">
              <label className="form-label">Заголовок Embed</label>
              <input className="form-control" type="text" value={embedTitle} onChange={e => setEmbedTitle(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Описание Embed</label>
              <textarea className="form-control" value={embedDesc} onChange={e => setEmbedDesc(e.target.value)} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Ссылка на изображение Embed</label>
                <input className="form-control" type="text" placeholder="https://..." value={embedImage} onChange={e => setEmbedImage(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Нижний колонтитул (Footer)</label>
                <input className="form-control" type="text" value={embedFooter} onChange={e => setEmbedFooter(e.target.value)} />
              </div>
            </div>
          </div>

          <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px dashed var(--border-color)', padding: '16px', borderRadius: 'var(--radius-md)' }}>
            <h4 style={{ fontSize: '1rem', marginBottom: '12px', display: 'flex', justifyContent: 'space-between' }}>
              <span>Ссылки-Кнопки (Link Buttons)</span>
              {buttons.length < 5 && (
                <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={handleAddButton}>
                  + Добавить кнопку
                </button>
              )}
            </h4>
            {buttons.map((btn, index) => (
              <div key={index} className="form-row" style={{ alignItems: 'flex-end', marginBottom: '12px' }}>
                <div style={{ flex: 2 }}>
                  <label className="form-label">Текст кнопки</label>
                  <input className="form-control" type="text" placeholder="Открыть сайт" value={btn.label} onChange={e => handleButtonChange(index, 'label', e.target.value)} />
                </div>
                <div style={{ flex: 3 }}>
                  <label className="form-label">URL ссылки</label>
                  <input className="form-control" type="text" placeholder="https://..." value={btn.url} onChange={e => handleButtonChange(index, 'url', e.target.value)} />
                </div>
                <button className="btn btn-danger" style={{ height: '42px' }} onClick={() => handleRemoveButton(index)}>Удалить</button>
              </div>
            ))}
          </div>
        </div>

        {/* SECTION 3: AUDIENCE & SETTINGS */}
        <div>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>3. Фильтры аудитории и Настройки рассылки</h3>
          
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Исключить Discord User ID (через запятую)</label>
              <input className="form-control" type="text" placeholder="123456, 789012" value={excludeUserIds} onChange={e => setExcludeUserIds(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Исключить Discord Role ID (через запятую)</label>
              <input className="form-control" type="text" placeholder="111222, 333444" value={excludeRoleIds} onChange={e => setExcludeRoleIds(e.target.value)} />
            </div>
          </div>

          <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input type="checkbox" id="excludeOwner" checked={excludeOwner} onChange={e => setExcludeOwner(e.target.checked)} />
            <label htmlFor="excludeOwner">Исключить владельца сервера</label>
          </div>

          <div className="form-row" style={{ marginTop: '20px' }}>
            <div className="form-group">
              <label className="form-label">Размер волны (Wave Size)</label>
              <input className="form-control" type="number" value={waveSize} onChange={e => setWaveSize(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Интервал задержки (мс)</label>
              <input className="form-control" type="number" placeholder="2000" value={delayMs} onChange={e => setDelayMs(e.target.value)} />
            </div>
          </div>

          <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input type="checkbox" id="isContinuous" checked={isContinuous} onChange={e => setIsContinuous(e.target.checked)} />
            <label htmlFor="isContinuous">Отправлять непрерывно (без волн ожидания)</label>
          </div>
        </div>

        {/* SECTION 4: PREVIEW & TESTING */}
        <div>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>4. Предпросмотр и Тестирование</h3>
          
          <div className="form-row" style={{ marginBottom: '24px' }}>
            <div>
              <button className="btn btn-secondary" onClick={handlePreview} disabled={previewLoading}>
                {previewLoading ? 'Расчет аудитории...' : '🔍 Рассчитать размер аудитории'}
              </button>

              {preview && (
                <div style={{ marginTop: '16px', padding: '16px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', fontSize: '0.9rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span>Всего на сервере:</span><strong>{preview.totalMembers}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                    <span>Исключено ботов:</span><span>{preview.botsExcluded}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                    <span>Исключено по ролям:</span><span>{preview.rolesExcluded}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                    <span>Исключено в черном списке:</span><span>{preview.blacklistExcluded}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                    <span>Исключено вручную:</span><span>{preview.manualExcluded}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-color)', paddingTop: '8px', marginTop: '8px', fontWeight: 'bold' }}>
                    <span>Итого получателей:</span><span style={{ color: 'var(--success-color)' }}>{preview.finalRecipientsCount}</span>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="form-label">Тестовые аккаунты Discord ID (через запятую)</label>
              <input className="form-control" type="text" placeholder="1234567890123" value={testUserIds} onChange={e => setTestUserIds(e.target.value)} />
              <button className="btn btn-secondary" style={{ marginTop: '12px' }} onClick={handleTestSend} disabled={testLoading}>
                {testLoading ? 'Отправка теста...' : '✉️ Отправить тестовое сообщение'}
              </button>

              {testResults && (
                <div style={{ marginTop: '12px', fontSize: '0.85rem' }}>
                  <strong>Результаты теста:</strong>
                  <ul style={{ paddingLeft: '20px', marginTop: '6px' }}>
                    {testResults.map((r, i) => (
                      <li key={i} style={{ color: r.success ? 'var(--success-color)' : 'var(--danger-color)' }}>
                        ID {r.userId}: {r.success ? `Успешно отправлено (${r.username})` : `Ошибка (${r.error})`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* SUBMIT BUTTON */}
        <div style={{ display: 'flex', gap: '16px', borderTop: '1px solid var(--border-color)', paddingTop: '24px' }}>
          <button className="btn btn-success" style={{ flex: 1 }} onClick={handleCreate}>
            💾 Создать кампанию (как Черновик)
          </button>
          <button className="btn btn-secondary" onClick={onBack}>Отмена</button>
        </div>

      </div>
    </div>
  );
}

// -------------------------------------------------------------
// CAMPAIGN DETAILS VIEW (Progress and worker control)
// -------------------------------------------------------------
function CampaignDetailsView({ campaignId, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [finalizing, setFinalizing] = useState(false);

  const fetchStats = () => {
    fetch(`/api/campaigns/${campaignId}`)
      .then(res => res.json())
      .then(data => {
        setData(data);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchStats();

    // Auto-poll stats when campaign is running
    const interval = setInterval(() => {
      if (data && data.campaign.status === 'RUNNING') {
        fetchStats();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [data?.campaign?.status]);

  const handleFinalize = () => {
    setFinalizing(true);
    fetch(`/api/campaigns/${campaignId}/finalize`, { method: 'POST' })
      .then(res => res.json())
      .then(() => {
        setFinalizing(false);
        fetchStats();
      })
      .catch(() => setFinalizing(false));
  };

  const handleAction = (action) => {
    fetch(`/api/campaigns/${campaignId}/${action}`, { method: 'POST' })
      .then(res => res.json())
      .then(() => {
        fetchStats();
      });
  };

  if (loading) return <div>Загрузка информации о кампании...</div>;

  const { campaign, stats, events } = data;

  const processed = (stats.SENT || 0) + (stats.DM_CLOSED || 0) + (stats.FAILED_PERMANENT || 0) + (stats.FAILED_TEMPORARY || 0);
  const total = (stats.PENDING || 0) + (stats.PROCESSING || 0) + processed + (stats.EXCLUDED || 0);
  const percent = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <div className="animate-fade">
      <div style={{ display: 'flex', gap: '20px', alignItems: 'center', marginBottom: '32px' }}>
        <button className="btn btn-secondary" onClick={onBack}>← К списку</button>
        <div>
          <h1 style={{ fontSize: '2rem', display: 'flex', alignItems: 'center', gap: '12px' }}>
            {campaign.name}
            <span className={`badge badge-${campaign.status.toLowerCase().split('_')[0]}`}>
              {campaign.status}
            </span>
          </h1>
        </div>
      </div>

      <div className="grid-cols-2" style={{ marginBottom: '40px' }}>
        {/* CONTROLS & STATS CARD */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>Состояние доставки</h3>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              <span>Прогресс выполнения</span>
              <span>{percent}% ({processed} / {total})</span>
            </div>
            <div className="progress-bar-container">
              <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '0.9rem' }}>
            <div style={{ padding: '12px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ color: 'var(--text-secondary)' }}>SENT (Успешно)</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--success-color)' }}>{stats.SENT || 0}</div>
            </div>
            <div style={{ padding: '12px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ color: 'var(--text-secondary)' }}>DM_CLOSED (ЛС закрыта)</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--warning-color)' }}>{stats.DM_CLOSED || 0}</div>
            </div>
            <div style={{ padding: '12px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ color: 'var(--text-secondary)' }}>FAILED_PERMANENT</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--danger-color)' }}>{stats.FAILED_PERMANENT || 0}</div>
            </div>
            <div style={{ padding: '12px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ color: 'var(--text-secondary)' }}>FAILED_TEMPORARY (Повторы)</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{stats.FAILED_TEMPORARY || 0}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
            {campaign.status === 'DRAFT' && (
              <button className="btn btn-warning" onClick={handleFinalize} disabled={finalizing} style={{ flex: 1 }}>
                {finalizing ? 'Создание аудитории...' : '🔒 Сформировать получателей (Финализировать)'}
              </button>
            )}

            {campaign.status === 'READY' && (
              <button className="btn btn-success" onClick={() => handleAction('start')} style={{ flex: 1 }}>
                ▶️ Запустить рассылку
              </button>
            )}

            {campaign.status === 'RUNNING' && (
              <>
                <button className="btn btn-warning" onClick={() => handleAction('pause')} style={{ flex: 1 }}>
                  ⏸️ Пауза
                </button>
                <button className="btn btn-danger" onClick={() => handleAction('stop')}>
                  🛑 Стоп
                </button>
              </>
            )}

            {campaign.status === 'PAUSED' && (
              <>
                <button className="btn btn-success" onClick={() => handleAction('resume')} style={{ flex: 1 }}>
                  ▶️ Продолжить рассылку
                </button>
                <button className="btn btn-danger" onClick={() => handleAction('stop')}>
                  🛑 Стоп
                </button>
              </>
            )}

            {campaign.status === 'AWAITING_CONFIRMATION' && (
              <>
                <button className="btn btn-primary" onClick={() => handleAction('continue-wave')} style={{ flex: 1 }}>
                  🌊 Подтвердить следующую волну
                </button>
                <button className="btn btn-warning" onClick={() => handleAction('pause')}>
                  ⏸️ Пауза
                </button>
                <button className="btn btn-danger" onClick={() => handleAction('stop')}>
                  🛑 Стоп
                </button>
              </>
            )}

            {(campaign.status === 'COMPLETED' || campaign.status === 'STOPPED' || campaign.status === 'FAILED') && (
              <a href={`/api/campaigns/${campaign.id}/export`} className="btn btn-secondary" style={{ flex: 1, textDecoration: 'none' }}>
                📥 Выгрузить CSV отчет
              </a>
            )}
          </div>
        </div>

        {/* CAMPAIGN EVENTS LOG */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ fontSize: '1.2rem', marginBottom: '16px' }}>Журнал событий кампании</h3>
          <div style={{ flex: 1, overflowY: 'auto', maxHeight: '300px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {events.map((ev) => (
              <div key={ev.id} style={{ fontSize: '0.85rem', paddingBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span className="badge badge-draft" style={{ background: '#20222e' }}>{ev.event_type}</span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{new Date(ev.created_at).toLocaleTimeString()}</span>
                </div>
                <div>{ev.message}</div>
              </div>
            ))}
            {events.length === 0 && (
              <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '20px' }}>Событий пока нет.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// GLOBAL EXCLUSIONS VIEW
// -------------------------------------------------------------
function ExclusionsView() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);

  // Search members state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  
  // Add role inputs
  const [newRoleId, setNewRoleId] = useState('');

  const fetchExclusions = () => {
    Promise.all([
      fetch('/api/exclusions/users').then(res => res.json()),
      fetch('/api/exclusions/roles').then(res => res.json())
    ]).then(([u, r]) => {
      setUsers(u);
      setRoles(r);
      setLoading(false);
    });
  };

  useEffect(() => {
    fetchExclusions();
  }, []);

  const handleSearch = (q) => {
    setSearchQuery(q);
    if (q.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    fetch(`/api/guild/members/search?q=${encodeURIComponent(q)}`)
      .then(res => res.json())
      .then(data => setSearchResults(data || []));
  };

  const handleAddUser = (userId, username) => {
    fetch('/api/exclusions/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId })
    })
      .then(res => res.json())
      .then(() => {
        setSearchQuery('');
        setSearchResults([]);
        fetchExclusions();
      });
  };

  const handleAddRole = () => {
    if (!newRoleId.trim()) return;
    fetch('/api/exclusions/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roleId: newRoleId })
    })
      .then(res => res.json())
      .then(() => {
        setNewRoleId('');
        fetchExclusions();
      });
  };

  const handleRemoveUser = (userId) => {
    fetch(`/api/exclusions/users/${userId}`, { method: 'DELETE' })
      .then(res => res.json())
      .then(() => fetchExclusions());
  };

  const handleRemoveRole = (roleId) => {
    fetch(`/api/exclusions/roles/${roleId}`, { method: 'DELETE' })
      .then(res => res.json())
      .then(() => fetchExclusions());
  };

  if (loading) return <div>Загрузка списков исключений...</div>;

  return (
    <div className="animate-fade">
      <h1 style={{ fontSize: '2rem', marginBottom: '6px' }}>Глобальный черный список</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '32px' }}>
        Пользователи и роли из этого списка будут автоматически исключаться из ВСЕХ создаваемых рассылок
      </p>

      <div className="grid-cols-2">
        {/* EXCLUDED USERS BLOCK */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '12px' }}>1. Черный список пользователей</h3>
            <div className="search-box">
              <input className="form-control" type="text" placeholder="Поиск пользователя по нику или ID..." value={searchQuery} onChange={e => handleSearch(e.target.value)} />
              {searchResults.length > 0 && (
                <div className="search-results">
                  {searchResults.map((m) => (
                    <div key={m.id} className="search-item" onClick={() => handleAddUser(m.id, m.username)}>
                      {m.displayName} ({m.username}) {m.bot && '🤖'}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={{ maxHeight: '350px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
            <table>
              <thead>
                <tr>
                  <th>Пользователь</th>
                  <th>ID</th>
                  <th>Действие</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.discord_user_id}>
                    <td>{u.username}</td>
                    <td><span className="meta-code">{u.discord_user_id}</span></td>
                    <td>
                      <button className="btn btn-danger" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => handleRemoveUser(u.discord_user_id)}>
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan="3" style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '20px' }}>Пользователей в списке нет.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* EXCLUDED ROLES BLOCK */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '12px' }}>2. Черный список ролей</h3>
            <div className="form-row">
              <input className="form-control" type="text" placeholder="Вставьте Discord Role ID..." value={newRoleId} onChange={e => setNewRoleId(e.target.value)} />
              <button className="btn btn-primary" onClick={handleAddRole}>Добавить</button>
            </div>
          </div>

          <div style={{ maxHeight: '350px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
            <table>
              <thead>
                <tr>
                  <th>Роль</th>
                  <th>ID</th>
                  <th>Действие</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((r) => (
                  <tr key={r.role_id}>
                    <td>{r.role_name}</td>
                    <td><span className="meta-code">{r.role_id}</span></td>
                    <td>
                      <button className="btn btn-danger" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => handleRemoveRole(r.role_id)}>
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}
                {roles.length === 0 && (
                  <tr>
                    <td colSpan="3" style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '20px' }}>Ролей в списке нет.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// SYSTEM AUDIT LOG VIEW
// -------------------------------------------------------------
function AuditView() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/audit')
      .then(res => res.json())
      .then(data => {
        setLogs(data);
        setLoading(false);
      });
  }, []);

  if (loading) return <div>Загрузка системных логов...</div>;

  return (
    <div className="animate-fade">
      <h1 style={{ fontSize: '2rem', marginBottom: '6px' }}>Аудит действий администраторов</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '32px' }}>
        Хронология всех операций, совершенных в веб-панели управления
      </p>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Администратор ID</th>
              <th>Операция</th>
              <th>Цель (Target)</th>
              <th>Детали (Metadata)</th>
              <th>Дата и Время</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td>{l.id}</td>
                <td><span className="meta-code">{l.admin_discord_id}</span></td>
                <td><span className="badge badge-draft" style={{ background: '#20222e' }}>{l.action}</span></td>
                <td>{l.target || '—'}</td>
                <td>
                  {l.metadata ? (
                    <span className="meta-code" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {JSON.stringify(l.metadata)}
                    </span>
                  ) : '—'}
                </td>
                <td>{new Date(l.timestamp).toLocaleString()}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Логи действий пока пусты.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
