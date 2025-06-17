/* ============ 全局状态 ============ */
let conversations = [];   // 原始数组（会被就地修改）
let activeIdx = null;     // 当前会话索引
let messages = [];        // 当前会话展开的 message 引用（与 conversations 内对象同源）
let contextMenu = null;   // 右键菜单引用
let searchTerm = '';      // 当前搜索词
let searchHighlights = [];// 搜索高亮位置
let currentSearchIndex = -1; // 当前搜索结果索引
let totalSearchResults = 0; // 总搜索结果数
let searchQueue = [];                // 待异步扫描的对话队列
let convHoverTooltip = null;         // 悬浮会话 tooltip 实例

/* ============ DOM refs ============ */
const fileInput  = document.getElementById('file-input');
const convList   = document.getElementById('conv-list');
const chatPanel  = document.getElementById('chat');
const exportArea = document.getElementById('export-area');
const exportAll  = document.getElementById('export-all');
const exportOne  = document.getElementById('export-one');
const sidebar    = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const mobileOverlay = document.getElementById('mobile-overlay');
const floatingSidebarBtn = document.getElementById('floating-sidebar-btn');
const searchInput = document.getElementById('search-input');
const searchNavigation = document.getElementById('search-navigation');
const searchCounter = document.getElementById('search-counter');
const searchPrev = document.getElementById('search-prev');
const searchNext = document.getElementById('search-next');

/* ============ 工具函数 ============ */
const fmt = t => t ? dayjs(t).format('YYYY-MM-DD HH:mm:ss') : '';
const $ = id => document.getElementById(id);

/* 把各种字段统一转成时间戳（毫秒） */
const toMillis = m => {
  const raw = m.timestamp || m.created_at ||
              m.content?.[0]?.start_timestamp || m.time || '';
  return raw ? +new Date(raw) : 0;
};

/* 计算会话第一条有效消息的时间（毫秒） */
const firstMillis = conv => {
  const msgs = conv.chat_messages || [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (['human', 'assistant'].includes(m.sender) && m.text?.trim()) {
      return toMillis(m);
    }
  }
  return 0;
};

/* 计算会话最后一条有效消息的时间（毫秒） */
const lastMillis = conv => {
  const msgs = conv.chat_messages || [];
  // 从后往前找第一条 human / assistant 且有文本的消息
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (['human', 'assistant'].includes(m.sender) && m.text?.trim()) {
      return toMillis(m);
    }
  }
  return 0;           // 没找到就返回 0，排在最末
};

/* 搜索输入框 */
searchInput.addEventListener('input', (e) => {
  performSearch(e.target.value);
});

/* ESC 清空搜索 */
document.addEventListener('keydown', (e) => {
  // ESC 清空搜索
  if (e.key === 'Escape' && document.activeElement === searchInput) {
    searchInput.value = '';
    performSearch('');
    searchInput.blur();
  }
});

/* 移动端侧边栏切换 */
function toggleSidebar() {
  const isCollapsed = sidebar.classList.contains('collapsed');
  
  if (isCollapsed) {
    // 展开侧边栏
    sidebar.classList.remove('collapsed');
    if (window.innerWidth <= 768) {
      mobileOverlay.style.display = 'block';
    }
    if (sidebarToggle) {
      sidebarToggle.textContent = '☰ 隐藏会话列表';
    }
  } else {
    // 收起侧边栏
    sidebar.classList.add('collapsed');
    mobileOverlay.style.display = 'none';
    if (sidebarToggle) {
      sidebarToggle.textContent = '☰ 显示会话列表';
    }
  }
}

if (sidebarToggle) {
  sidebarToggle.addEventListener('click', toggleSidebar);
}

/* 浮动按钮控制侧边栏 */
if (floatingSidebarBtn) {
  floatingSidebarBtn.addEventListener('click', toggleSidebar);
}

/* 点击遮罩层关闭侧边栏 */
if (mobileOverlay) {
  mobileOverlay.addEventListener('click', () => {
    sidebar.classList.add('collapsed');
    mobileOverlay.style.display = 'none';
    if (sidebarToggle) {
      sidebarToggle.textContent = '☰ 显示会话列表';
    }
  });
}

/* 文件拖拽悬停阻止默认行为 */
document.addEventListener('dragover', (e) => {
  e.preventDefault();
});

/* 渲染左侧会话列表 - 添加搜索过滤 */
function renderConvList(){
  convList.innerHTML='';
  
  // 过滤符合搜索条件的对话框
  const filteredConversations = conversations.filter(conversationMatchesSearch);
  
  filteredConversations.forEach((c,i)=>{
    // 找到原始索引
    const originalIdx = conversations.findIndex(conv => conv === c);
    
    const b=document.createElement('button');
    b.className='conv-btn'+(originalIdx===activeIdx?' active':'');
    
    // 高亮搜索结果
    b.innerHTML = highlightSearchText(c.name);
    
    b.onclick=()=>selectConv(originalIdx);

    /* ---------- 悬停显示时间 Tooltip ---------- */
    b.addEventListener('mouseenter', ()=>{
      showConvTooltip(b,c);
    });
    b.addEventListener('mouseleave', hideConvTooltip);
    b.addEventListener('mousemove', (e)=>{
      if(convHoverTooltip){
        convHoverTooltip.style.top = (e.clientY + 12) + 'px';
        convHoverTooltip.style.left = (e.clientX + 12) + 'px';
      }
    });
    
    convList.appendChild(b);
  });

  if(activeIdx===null){
    chatPanel.innerHTML=`
      <div style="text-align:center;font-size:16px;color:#64748b">
        <div style="font-size:48px;margin-bottom:16px">💬</div>
        <div>请选择会话开始查看</div>
      </div>
    `;
    chatPanel.style.justifyContent='center';
    exportArea.style.display='none';
  }
  
  // 更新导出按钮状态
  if (conversations.length > 0) {
    updateExportButtons();
  }
  
  // 初始化移动端状态
  initMobileState();
}

/* 选中会话 */
function selectConv(i){
  activeIdx = i;
  const raw = conversations[i].chat_messages || [];

  /* -------- 时间排序：先过滤再排序 -------- */
  messages = raw
    .filter(m => ['human','assistant'].includes(m.sender) && m.text?.trim())
    .sort((a, b) => toMillis(a) - toMillis(b))   // ⬅️ 关键：按毫秒值升序
    .map(m => { m._images ??= []; return m; });

  /* 同步引用，保证导出 JSON 也按新顺序 */
  conversations[i].chat_messages = messages;

  renderConvList();
  renderChat();
  exportArea.style.display = 'flex';
  
  // 重置搜索索引并更新搜索结果
  currentSearchIndex = -1;
  updateSearchResults();
  
  /* 移动端选择会话后自动收起侧边栏 */
  if (window.innerWidth <= 768) {
    // 在移动端，选择会话后总是收起侧边栏
    sidebar.classList.add('collapsed');
    mobileOverlay.style.display = 'none';
    if (sidebarToggle) {
      sidebarToggle.textContent = '☰ 显示会话列表';
    }
  }
}

/* 重新渲染聊天区 - 添加搜索高亮 */
function renderChat(){
  chatPanel.innerHTML='';
  chatPanel.style.justifyContent='flex-start';

  // 显示所有消息，保持原始顺序
  messages.forEach((m,originalIdx)=>{
    
    const wrap=document.createElement('div');
    wrap.className=`msg ${m.sender==='human'?'user':'assistant'}`;

    /* ---------- 右键菜单 ---------- */
    wrap.addEventListener('contextmenu', (e) => {
      const selection = window.getSelection();
      const selectedText = selection.toString().trim();
      
      if (selectedText) {
        showContextMenu(e, selectedText);
      }
    });

    /* ---------- 行首时间戳 ---------- */
    const ts=document.createElement('div');
    ts.className='timestamp'; 
    ts.textContent=fmt(m.timestamp||m.created_at||m.content?.[0]?.start_timestamp);
    wrap.appendChild(ts);

    /* ---------- 彩泡 / Markdown 带搜索高亮 ---------- */
    const bubble=document.createElement('div');
    bubble.className='bubble';
    const highlightedText = highlightSearchText(m.text);
    bubble.innerHTML=marked.parse(highlightedText);
    wrap.appendChild(bubble);

    /* ---------- 已插入图片 ---------- */
    m._images.forEach((src,pi)=>{
      const holder=document.createElement('div');
      holder.className='img-wrap';
      const img=document.createElement('img');
      img.src=src; img.className='upload';
      
      // 添加点击展开功能
      img.onclick = (e) => {
        e.stopPropagation();
        showImageModal(src);
      };
      
      const del=document.createElement('button');
      del.textContent='✖️';
      del.onclick=(e)=>{
        e.stopPropagation();
        m._images.splice(pi,1);
        renderChat();
      };
      holder.appendChild(img);
      holder.appendChild(del);
      wrap.appendChild(holder);
    });

    /* ---------- 浮动操作按钮 ---------- */
    const actions=document.createElement('div');
    actions.className='actions';
    actions.innerHTML=
      '<button class="icon-btn cam" title="插入图片">📷</button>'+
      '<button class="icon-btn del" title="删除消息">🗑️</button>';
    wrap.appendChild(actions);

    // 删除消息
    actions.querySelector('.del').onclick=()=>{
      messages.splice(originalIdx,1);
      renderChat();
    };

    // 插图菜单
    actions.querySelector('.cam').onclick=()=>{
      const menu=document.createElement('div');
      menu.className='menu-popup';
      menu.style.top='28px'; 
      menu.style.right='0';
      menu.innerHTML='<button>📁 本地上传</button><button>🔗 链接插入</button>';
      actions.appendChild(menu);

      // 本地
      menu.children[0].onclick=()=>{
        const inp=document.createElement('input');
        inp.type='file'; inp.accept='image/*';
        inp.onchange=e=>{
          const f=e.target.files[0]; if(!f) return;
          const fr=new FileReader();
          fr.onload=ev=>{ m._images.push(ev.target.result); renderChat(); };
          fr.readAsDataURL(f);
        };
        inp.click();
        actions.removeChild(menu);
      };
      
      // 链接
      menu.children[1].onclick=()=>{
        const url=prompt('请输入图片 URL：');
        if(url && url.trim()) { m._images.push(url.trim()); renderChat(); }
        actions.removeChild(menu);
      };
      
      // 点击外部关闭
      document.addEventListener('click', function h(ev){
        if(!menu.contains(ev.target) && !actions.contains(ev.target)){ 
          if(actions.contains(menu)) actions.removeChild(menu); 
          document.removeEventListener('click',h); 
        }
      }, {capture:true});
    };

    chatPanel.appendChild(wrap);
  });
  
  // 更新导出按钮状态（因为可能添加或删除了本地图片）
  updateExportButtons();

  if(messages.length===0){
    chatPanel.innerHTML=`
      <div style="text-align:center;font-size:16px;color:#64748b">
        <div style="font-size:48px;margin-bottom:16px">📭</div>
        <div>此会话暂无可显示消息</div>
      </div>
    `;
    chatPanel.style.justifyContent='center';
  }
}

/* ============ 导出 JSON ============ */
function downloadJSON(obj,filename){
  const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=filename; a.click();
  URL.revokeObjectURL(a.href);
}

/* 检查是否包含本地上传的图片（base64） */
function hasLocalImages(conversations) {
  return conversations.some(conv => {
    const messages = conv.chat_messages || [];
    return messages.some(msg => {
      const images = msg._images || [];
      return images.some(src => src.startsWith('data:'));
    });
  });
}

/* 更新导出按钮状态 */
function updateExportButtons() {
  const hasLocal = hasLocalImages(conversations);
  
  if (hasLocal) {
    exportAll.disabled = true;
    exportAll.textContent = '🚫 包含本地图片，无法整包导出';
    exportAll.style.background = 'linear-gradient(135deg, #94a3b8, #64748b)';
    exportAll.style.cursor = 'not-allowed';
  } else {
    exportAll.disabled = false;
    exportAll.textContent = '⬇️ 导出整包 JSON';
    exportAll.style.background = 'linear-gradient(135deg, #059669, #047857)';
    exportAll.style.cursor = 'pointer';
    exportAll.title = '';
  }
}

/* 导出整包 */
exportAll.onclick=()=>{
  if (exportAll.disabled) return;
  // conversations 已被就地改写；直接导出
  downloadJSON(conversations,'claude_export_all.json');
};

/* 导出当前会话 */
exportOne.onclick=()=>{
  if(activeIdx===null) return;
  downloadJSON(conversations[activeIdx], (conversations[activeIdx].name||'conversation')+'.json');
};

/* 文件拖拽支持（改为流式解析） */
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = e.dataTransfer.files;
  if (files.length > 0 && files[0].type === 'application/json') {
    loadJsonStreaming(files[0]);
  }
});

/* ============ 文件导入（流式解析） ============ */
/**
 * 使用浏览器 ReadableStream + oboe.js 对大型 JSON 文件进行流式解析，
 * 只要解析到会话根对象（含 name/uuid 等信息）就立即插入列表，
 * 避免一次性 JSON.parse 带来的主线程阻塞。
 */
function loadJsonStreaming(file) {
  // 清空旧数据与界面
  conversations = [];
  activeIdx = null;
  renderConvList();

  // 提示信息
  convList.innerHTML = '<div style="padding:20px;text-align:center;color:#64748b">⏳ 正在解析文件，请稍候...</div>';

  // oboe 实例
  const parser = oboe();

  // 每解析到一个会话对象就推入数组并刷新列表（保持最新排序）
  parser.node('![*]', (conv) => {
    if (conv && conv.name && conv.name.trim()) {
      conversations.push(conv);
      conversations.sort((a, b) => lastMillis(b) - lastMillis(a));
      renderConvList();
    }
  });

  // 解析完毕回调；用于处理根即单个对话对象的情况
  parser.done((root) => {
    if (conversations.length === 0) {
      // root 可能是单对象或对象数组
      const arr = Array.isArray(root) ? root : [root];
      arr.forEach(conv => {
        if (conv && conv.name && conv.name.trim()) {
          conversations.push(conv);
        }
      });
      conversations.sort((a, b) => lastMillis(b) - lastMillis(a));
    }

    // 若解析完成仍无数据，则显示提示
    if (conversations.length === 0) {
      convList.innerHTML = '<div style="padding:20px;text-align:center;color:#64748b">⚠️ 未检测到有效会话</div>';
    } else {
      renderConvList();
    }
  });

  parser.fail((err) => {
    alert('解析失败: ' + (err.thrown || err));
  });

  // 读取文件流并喂给 oboe
  const decoder = new TextDecoder('utf-8');
  let reader;

  // 优先使用原生 stream，低版本浏览器回退到 FileReader
  if (file.stream && typeof file.stream === 'function') {
    reader = file.stream().getReader();
  } else {
    // 回退：一次性读取，但依旧避免 JSON.parse（只是渲染进度无法实时更新）
    const fr = new FileReader();
    fr.onload = (e) => {
      parser.emit('data', e.target.result);
      parser.emit('done');
    };
    fr.readAsText(file, 'utf-8');
    return;
  }

  function pump() {
    reader.read().then(({ done, value }) => {
      if (done) {
        parser.emit('done');
        return;
      }
      parser.emit('data', decoder.decode(value, { stream: true }));
      // 继续读取下一块
      pump();
    });
  }

  pump();
}

/* 页面加载完成后初始化 */
document.addEventListener('DOMContentLoaded', () => {
  initMobileState();
});

/* 窗口大小变化时重新初始化 */
window.addEventListener('resize', () => {
  if (window.innerWidth > 768) {
    // 桌面端：移除collapsed类，隐藏遮罩
    sidebar.classList.remove('collapsed');
    mobileOverlay.style.display = 'none';
  } else {
    // 移动端：初始化状态
    initMobileState();
  }
});

/* 关闭右键菜单 */
function closeContextMenu() {
  if (contextMenu) {
    contextMenu.remove();
    contextMenu = null;
  }
}

/* 显示右键菜单 */
function showContextMenu(e, selectedText) {
  e.preventDefault();
  closeContextMenu();
  
  if (!selectedText) return;
  
  contextMenu = document.createElement('div');
  contextMenu.className = 'context-menu';
  contextMenu.innerHTML = `
    <button class="context-menu-item" onclick="copyToClipboard('${selectedText.replace(/'/g, "\\'")}')">
      📋 复制原格式文本
    </button>
  `;
  
  document.body.appendChild(contextMenu);
  
  // 定位菜单
  const rect = contextMenu.getBoundingClientRect();
  const x = Math.min(e.clientX, window.innerWidth - rect.width - 10);
  const y = Math.min(e.clientY, window.innerHeight - rect.height - 10);
  
  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
}

/* 复制到剪贴板 */
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    console.log('文本已复制到剪贴板');
  });
  closeContextMenu();
}

/* 显示图片模态框 */
function showImageModal(src) {
  const modal = document.createElement('div');
  modal.className = 'img-modal';
  
  const img = document.createElement('img');
  img.src = src;
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'close-btn';
  closeBtn.textContent = '✕';
  closeBtn.onclick = () => {
    document.body.removeChild(modal);
  };
  
  modal.appendChild(img);
  modal.appendChild(closeBtn);
  
  // 点击模态框背景关闭
  modal.onclick = (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  };
  
  // ESC键关闭
  const handleEsc = (e) => {
    if (e.key === 'Escape') {
      document.body.removeChild(modal);
      document.removeEventListener('keydown', handleEsc);
    }
  };
  document.addEventListener('keydown', handleEsc);
  
  document.body.appendChild(modal);
}

/* 初始化移动端状态 */
function initMobileState() {
  if (window.innerWidth <= 768) {
    sidebar.classList.add('collapsed');
    mobileOverlay.style.display = 'none';
    if (sidebarToggle) {
      sidebarToggle.textContent = '☰ 显示会话列表';
    }
  }
}

/* 全局点击事件，关闭菜单 */
document.addEventListener('click', (e) => {
  if (contextMenu && !contextMenu.contains(e.target)) {
    closeContextMenu();
  }
});

/* 读取 JSON 文件 */
fileInput.addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  loadJsonStreaming(f);
});

/* 搜索功能 */
function performSearch(term) {
  searchTerm = term.toLowerCase().trim();
  searchHighlights = [];
  currentSearchIndex = -1;   // 默认 -1 表示尚未定位
  totalSearchResults = 0;

  // 重新初始化缓存与队列
  searchQueue = [];
  conversations.forEach(conv => {
    conv._searchCache = null;
    conv._searchPending = false;
  });

  if (!searchTerm) {
    searchNavigation.style.display = 'none';
    renderConvList();
    renderChat();
    return;
  }

  // 初步渲染（仅根据标题匹配）
  renderConvList();

  // 排队待异步扫描所有对话内容
  conversations.forEach(conv => {
    if (!conv._searchPending) {
      conv._searchPending = true;
      searchQueue.push(conv);
    }
  });
  scheduleSearchBatch();

  // 如果有选中的会话，搜索并高亮聊天内容
  if (activeIdx !== null) {
    renderChat();
    updateSearchResults();
  } else {
    searchNavigation.style.display = 'none';
  }
}

/* 更新搜索结果计数和导航 */
function updateSearchResults() {
  if (!searchTerm || activeIdx === null) {
    searchNavigation.style.display = 'none';
    return;
  }
  
  // 计算所有匹配的搜索结果（包括同一消息中的多个匹配）
  searchHighlights = [];
  messages.forEach((message, messageIndex) => {
    if (messageMatchesSearch(message)) {
      // 计算这条消息中有多少个匹配
      const regex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = [...message.text.matchAll(regex)];
      
      // 为每个匹配创建一个搜索结果项
      matches.forEach((match, matchIndex) => {
        searchHighlights.push({
          messageIndex: messageIndex,
          matchIndex: matchIndex,
          matchStart: match.index,
          matchText: match[0]
        });
      });
    }
  });
  
  totalSearchResults = searchHighlights.length;
  
  if (totalSearchResults > 0) {
    searchNavigation.style.display = 'flex';
    // 若当前索引超界则重置为最后一个；保留 -1 代表未定位
    if (currentSearchIndex >= totalSearchResults) {
      currentSearchIndex = totalSearchResults - 1;
    }
    const displayIdx = currentSearchIndex >= 0 ? currentSearchIndex + 1 : 0;
    searchCounter.textContent = `${displayIdx}/${totalSearchResults}`;
    
    // 更新按钮状态
    searchPrev.disabled = currentSearchIndex <= 0;
    searchNext.disabled = currentSearchIndex >= totalSearchResults - 1;
  } else {
    searchNavigation.style.display = 'none';
  }
}

/* 高亮搜索结果 */
function highlightSearchText(text, className = 'search-highlight') {
  if (!searchTerm || !text) return text;
  
  const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(regex, `<mark class="${className}">$1</mark>`);
}

/* 检查对话框是否匹配搜索 */
function conversationMatchesSearch(conv) {
  if (!searchTerm) return true;

  // 名称匹配立即返回
  if (conv.name && conv.name.toLowerCase().includes(searchTerm)) {
    return true;
  }

  // 如果已有缓存且是当前搜索词，直接返回结果
  if (conv._searchCache && conv._searchCache.term === searchTerm) {
    return conv._searchCache.match;
  }

  // 尚未扫描完的先暂时保留，待异步扫描后再决定
  if (!conv._searchPending) {
    conv._searchPending = true;
    searchQueue.push(conv);
    scheduleSearchBatch();
  }
  return true;   // 先展示，稍后再刷新真实匹配结果
}

/* 检查消息是否匹配搜索 */
function messageMatchesSearch(message) {
  if (!searchTerm) return true;
  return message.text && message.text.toLowerCase().includes(searchTerm);
}

/* 搜索导航事件处理 */
searchPrev.addEventListener('click', () => {
  if (currentSearchIndex > 0) {
    currentSearchIndex--;
    updateSearchResults();
    scrollToSearchResult();
  }
});

searchNext.addEventListener('click', () => {
  if (currentSearchIndex < totalSearchResults - 1) {
    currentSearchIndex++;
    updateSearchResults();
    scrollToSearchResult();
  }
});

/* 滚动到当前搜索结果 */
function scrollToSearchResult() {
  if (!searchTerm || totalSearchResults === 0 || currentSearchIndex < 0) return;
  
  if (currentSearchIndex < searchHighlights.length) {
    const highlight = searchHighlights[currentSearchIndex];
    const targetMessageIndex = highlight.messageIndex;
    
    // 获取所有消息元素
    const messageElements = chatPanel.querySelectorAll('.msg');
    
    // 滚动到对应的消息元素
    if (messageElements[targetMessageIndex]) {
      messageElements[targetMessageIndex].scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center' 
      });
      
      // 添加临时高亮效果
      messageElements[targetMessageIndex].style.backgroundColor = 'rgba(59,130,246,0.1)';
      setTimeout(() => {
        messageElements[targetMessageIndex].style.backgroundColor = '';
      }, 1000);
    }
  }
}

/* ============ 增量搜索相关 ============ */
function scheduleSearchBatch() {
  // 如果没有排队或搜索词为空则跳过
  if (!searchTerm || searchQueue.length === 0) return;

  const process = (deadline) => {
    // deadline 可能不存在（setTimeout 回退）
    while ((deadline ? deadline.timeRemaining() > 0 : true) && searchQueue.length) {
      const conv = searchQueue.shift();
      conv._searchPending = false;
      // 扫描消息
      const msgs = conv.chat_messages || [];
      const matched = msgs.some(msg => msg.text && msg.text.toLowerCase().includes(searchTerm));
      conv._searchCache = { term: searchTerm, match: matched };
    }
    // 扫完一批后刷新列表
    renderConvList();
    // 继续排队
    if (searchQueue.length > 0) {
      if (window.requestIdleCallback) {
        requestIdleCallback(process);
      } else {
        setTimeout(() => process(), 0);
      }
    }
  };

  if (window.requestIdleCallback) {
    requestIdleCallback(process);
  } else {
    setTimeout(() => process(), 0);
  }
}

/* ============ 会话 Tooltip ============ */
function showConvTooltip(btn, conv){
  hideConvTooltip();
  convHoverTooltip = document.createElement('div');
  convHoverTooltip.className = 'conv-tooltip show';
  const createdMillis  = conv.created_at ? +new Date(conv.created_at) : firstMillis(conv);
  const updatedMillis  = conv.updated_at ? +new Date(conv.updated_at) : lastMillis(conv);
  const createdAt = createdMillis ? fmt(createdMillis) : '未知';
  const updatedAt = updatedMillis ? fmt(updatedMillis) : '未知';
  convHoverTooltip.innerHTML = `<div><strong>创建时间：</strong>${createdAt}</div><div><strong>更新时间：</strong>${updatedAt}</div>`;
  document.body.appendChild(convHoverTooltip);

  // 初始定位：鼠标偏移
  const rect = btn.getBoundingClientRect();
  convHoverTooltip.style.position='fixed';
  convHoverTooltip.style.left = (rect.right + 8) + 'px';
  convHoverTooltip.style.top  = (rect.top) + 'px';
}

function hideConvTooltip(){
  if(convHoverTooltip){
    convHoverTooltip.remove();
    convHoverTooltip = null;
  }
}
