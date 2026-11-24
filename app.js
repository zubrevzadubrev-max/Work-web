"use strict";

const $ = id => document.getElementById(id);
const STORAGE_KEY = "remote-work-v1";

let state = {
  tasks: [],
  notes: "",
  dark: false
};

let storageAvailable = true;

// Загружаем только локальные данные этого браузера.
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");

  if (saved && typeof saved === "object") {
    state.tasks = Array.isArray(saved.tasks)
      ? saved.tasks
          .filter(task =>
            task &&
            typeof task.id === "string" &&
            typeof task.title === "string"
          )
          .map(task => ({
            id: task.id,
            title: task.title.slice(0, 180),
            done: Boolean(task.done),
            priority: task.priority === "high" ? "high" : "normal"
          }))
      : [];

    state.notes = typeof saved.notes === "string"
      ? saved.notes.slice(0, 20000)
      : "";

    state.dark = saved.dark === true;
  }
} catch {
  storageAvailable = false;
}

let toastTimeout;

function notify(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;

  clearTimeout(toastTimeout);

  toastTimeout = setTimeout(() => {
    $("toast").hidden = true;
  }, 5000);
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    storageAvailable = true;
  } catch {
    storageAvailable = false;
    notify("Не удалось сохранить данные. Скачай задачи и заметки.");
  }
}

// Пользовательский текст вставляется через textContent.
function createElement(tag, text, className) {
  const element = document.createElement(tag);

  if (text !== undefined) {
    element.textContent = text;
  }

  if (className) {
    element.className = className;
  }

  return element;
}

/* ЗАДАЧИ */

let currentFilter = "all";

function renderTasks() {
  $("totalTasks").textContent = state.tasks.length;
  $("doneTasks").textContent =
    state.tasks.filter(task => task.done).length;

  const list = $("taskList");
  list.replaceChildren();

  const visibleTasks = state.tasks.filter(task => {
    if (currentFilter === "active") return !task.done;
    if (currentFilter === "done") return task.done;
    return true;
  });

  if (!visibleTasks.length) {
    list.append(
      createElement(
        "p",
        currentFilter === "all"
          ? "Пока нет задач. Добавь первую!"
          : "В этом разделе пока нет задач.",
        "empty"
      )
    );

    return;
  }

  visibleTasks.forEach(task => {
    const row = createElement(
      "div",
      undefined,
      "task-row" + (task.done ? " done" : "")
    );

    const checkbox = createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.done;
    checkbox.id = "task-" + task.id;

    checkbox.addEventListener("change", () => {
      task.done = checkbox.checked;
      save();
      renderTasks();
    });

    const label = createElement("label", task.title);
    label.htmlFor = checkbox.id;

    const deleteButton = createElement("button", "×", "delete");
    deleteButton.type = "button";
    deleteButton.setAttribute(
      "aria-label",
      "Удалить задачу: " + task.title
    );

    deleteButton.addEventListener("click", () => {
      state.tasks = state.tasks.filter(item => item.id !== task.id);
      save();
      renderTasks();
    });

    row.append(checkbox, label);

    if (task.priority === "high") {
      row.append(createElement("span", "Важно", "badge"));
    }

    row.append(deleteButton);
    list.append(row);
  });
}

$("taskForm").addEventListener("submit", event => {
  event.preventDefault();

  const title = $("taskInput").value.trim();

  if (!title) return;

  state.tasks.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    title,
    priority: $("taskPriority").value,
    done: false
  });

  save();
  renderTasks();

  $("taskInput").value = "";
  $("taskInput").focus();
});

document.querySelectorAll("[data-filter]").forEach(button => {
  button.addEventListener("click", () => {
    currentFilter = button.dataset.filter;

    document.querySelectorAll("[data-filter]").forEach(item => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });

    renderTasks();
  });
});

/* ФАЙЛЫ — ТОЛЬКО В ПАМЯТИ ВКЛАДКИ */

let files = [];

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " Б";

  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + " КБ";
  }

  return (bytes / (1024 * 1024)).toFixed(1) + " МБ";
}

function renderFiles() {
  $("totalFiles").textContent = files.length;

  const list = $("fileList");
  list.replaceChildren();

  files.forEach(item => {
    const row = createElement("div", undefined, "file-row");

    const link = createElement("a", item.file.name);
    link.href = item.url;
    link.download = item.file.name;

    const size = createElement(
      "small",
      formatFileSize(item.file.size)
    );

    const deleteButton = createElement("button", "×", "delete");
    deleteButton.type = "button";
    deleteButton.setAttribute(
      "aria-label",
      "Убрать файл: " + item.file.name
    );

    deleteButton.addEventListener("click", () => {
      URL.revokeObjectURL(item.url);
      files = files.filter(file => file !== item);
      renderFiles();
    });

    row.append(link, size, deleteButton);
    list.append(row);
  });
}

function addFiles(incomingFiles) {
  for (const file of incomingFiles) {
    if (file.size > 10 * 1024 * 1024) {
      notify("Файл «" + file.name + "» больше 10 МБ.");
      continue;
    }

    if (files.length >= 30) {
      notify("Можно прикрепить максимум 30 файлов.");
      break;
    }

    const duplicate = files.some(item =>
      item.file.name === file.name &&
      item.file.size === file.size &&
      item.file.lastModified === file.lastModified
    );

    if (duplicate) continue;

    files.push({
      file,
      url: URL.createObjectURL(file)
    });
  }

  renderFiles();
}

$("fileInput").addEventListener("change", event => {
  addFiles(event.target.files);
  event.target.value = "";
});

const dropzone = $("dropzone");

["dragenter", "dragover"].forEach(eventName => {
  dropzone.addEventListener(eventName, event => {
    event.preventDefault();
    dropzone.classList.add("drag");
  });
});

["dragleave", "drop"].forEach(eventName => {
  dropzone.addEventListener(eventName, event => {
    event.preventDefault();
    dropzone.classList.remove("drag");
  });
});

dropzone.addEventListener("drop", event => {
  addFiles(event.dataTransfer.files);
});

// Не даём браузеру открыть перетаскиваемый файл вместо сайта.
window.addEventListener("dragover", event => event.preventDefault());
window.addEventListener("drop", event => event.preventDefault());

// Предупреждение о потере прикреплённых файлов при закрытии.
window.addEventListener("beforeunload", event => {
  if (files.length > 0) {
    event.preventDefault();
    event.returnValue = "";
  }
});

/* ТАЙМЕР */

let duration = 25 * 60;
let remaining = duration;
let deadline = 0;
let timerRunning = false;

function renderTimer() {
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  $("timerDisplay").textContent =
    String(minutes).padStart(2, "0") +
    ":" +
    String(seconds).padStart(2, "0");

  $("startTimer").textContent = timerRunning
    ? "Пауза"
    : remaining === 0
      ? "Ещё раз"
      : "Начать";
}

function updateTimer() {
  if (!timerRunning) return;

  remaining = Math.max(
    0,
    Math.ceil((deadline - Date.now()) / 1000)
  );

  if (remaining === 0) {
    timerRunning = false;

    $("timerStatus").textContent = duration === 25 * 60
      ? "Отличная работа! Пора немного отдохнуть."
      : "Перерыв окончен. Можно возвращаться к делу.";

    notify("Таймер завершён.");
  }

  renderTimer();
}

setInterval(updateTimer, 250);
document.addEventListener("visibilitychange", updateTimer);

$("startTimer").addEventListener("click", () => {
  if (timerRunning) {
    updateTimer();
    timerRunning = false;
    $("timerStatus").textContent = remaining > 0
      ? "Таймер на паузе."
      : "Таймер завершён.";
  } else {
    if (remaining === 0) remaining = duration;

    deadline = Date.now() + remaining * 1000;
    timerRunning = true;

    $("timerStatus").textContent = duration === 25 * 60
      ? "Сейчас только ты и твоя задача."
      : "Время отдохнуть от работы.";
  }

  renderTimer();
});

function resetTimer() {
  timerRunning = false;
  remaining = duration;

  $("timerStatus").textContent = duration === 25 * 60
    ? "Выдели время для одной задачи."
    : "Сделай небольшой перерыв.";

  renderTimer();
}

$("resetTimer").addEventListener("click", resetTimer);

document.querySelectorAll("[data-minutes]").forEach(button => {
  button.addEventListener("click", () => {
    duration = Number(button.dataset.minutes) * 60;
    resetTimer();

    document.querySelectorAll("[data-minutes]").forEach(item => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
  });
});

/* ЗАМЕТКИ */

$("notes").value = state.notes;

$("notes").addEventListener("input", () => {
  state.notes = $("notes").value;
  save();

  $("saveStatus").textContent = storageAvailable
    ? "Сохранено в этом браузере."
    : "Не сохранено. Скачай резервную копию.";
});

/* ТЕМА */

function renderTheme() {
  document.body.classList.toggle("dark", state.dark);

  $("themeButton").textContent = state.dark
    ? "Светлая тема"
    : "Тёмная тема";

  $("themeButton").setAttribute(
    "aria-pressed",
    String(state.dark)
  );
}

$("themeButton").addEventListener("click", () => {
  state.dark = !state.dark;
  renderTheme();
  save();
});

/* СКАЧИВАНИЕ ЗАДАЧ И ЗАМЕТОК */

$("exportButton").addEventListener("click", () => {
  const taskText = state.tasks.map(task => {
    return "- [" + (task.done ? "x" : " ") + "] " +
      task.title +
      (task.priority === "high" ? " (важно)" : "");
  }).join("\n");

  const text =
    "МОИ ЗАДАЧИ\n\n" +
    taskText +
    "\n\nЗАМЕТКИ\n\n" +
    state.notes;

  const blob = new Blob([text], {
    type: "text/plain;charset=utf-8"
  });

  const url = URL.createObjectURL(blob);
  const link = createElement("a");

  link.href = url;
  link.download = "my-workspace.txt";

  document.body.append(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);

  notify("Задачи и заметки скачаны. Файлы в эту копию не входят.");
});

/* ДАТА И НАВИГАЦИЯ */

$("date").textContent = new Intl.DateTimeFormat("ru-RU", {
  weekday: "long",
  day: "numeric",
  month: "long"
}).format(new Date());

function updateNavigation() {
  const currentSection = location.hash || "#home";

  document.querySelectorAll("nav a").forEach(link => {
    link.classList.toggle(
      "current",
      link.getAttribute("href") === currentSection
    );
  });
}

window.addEventListener("hashchange", updateNavigation);

renderTasks();
renderFiles();
renderTimer();
renderTheme();
updateNavigation();

if (!storageAvailable) {
  notify(
    "Хранилище браузера недоступно. " +
    "Скачивай задачи и заметки, чтобы не потерять их."
  );
}
