"use strict";

const $ = (id) => document.getElementById(id);

let database;
let user = null;
let registerMode = false;
let timer;
let noticeTimer;
let refreshBusy = false;
let lastSnapshot = "";
let generation = 0;

const SESSION_KEY = "udalenka-demo-session";

const ALLOWED_EXTENSIONS = new Set([
  "pdf", "txt", "png", "jpg", "jpeg", "webp", "zip"
]);

function notify(message) {
  $("notice").textContent = message;
  $("notice").classList.remove("hidden");

  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    $("notice").classList.add("hidden");
  }, 5000);
}

function element(tag, text, className) {
  const item = document.createElement(tag);

  if (text !== undefined) item.textContent = text;
  if (className) item.className = className;

  return item;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("udalenka-demo", 1);

    request.onupgradeneeded = () => {
      const db = request.result;

      db.createObjectStore("users", { keyPath: "email" });
      db.createObjectStore("messages", {
        keyPath: "id",
        autoIncrement: true
      });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      notify("Закрой другие вкладки этого сайта и обнови страницу.");
    };
  });
}

// Запись считается успешной только после завершения транзакции.
function storeRequest(storeName, mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let result;

    let request;
    try {
      request = operation(store);
    } catch (error) {
      transaction.abort();
      reject(error);
      return;
    }

    request.onsuccess = () => {
      result = request.result;
    };

    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => {
      reject(transaction.error || new Error("Операция отменена"));
    };
    transaction.onerror = () => {
      reject(transaction.error || new Error("Ошибка базы данных"));
    };
  });
}

const getUser = (email) =>
  storeRequest("users", "readonly", (store) => store.get(email));

const getUsers = () =>
  storeRequest("users", "readonly", (store) => store.getAll());

const getMessages = () =>
  storeRequest("messages", "readonly", (store) => store.getAll());

function toHex(bytes) {
  return Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const result = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    salt: new TextEncoder().encode(salt),
    iterations: 100000,
    hash: "SHA-256"
  }, key, 256);

  return toHex(new Uint8Array(result));
}

function reportError(error) {
  console.error(error);

  if (error?.name === "QuotaExceededError") {
    notify("Память браузера заполнена. Удали ненужные сообщения с файлами.");
  } else if (error?.name === "ConstraintError") {
    notify("Этот email уже зарегистрирован в данном браузере.");
  } else {
    notify(error?.message || "Не удалось выполнить действие.");
  }
}

function clearFile() {
  $("file").value = "";
  $("fileLabel").textContent =
    "PDF, TXT, изображения, ZIP · до 10 МБ";
  $("clearFile").classList.add("hidden");
}

function showAuth() {
  generation++;
  clearInterval(timer);
  user = null;
  lastSnapshot = "";

  $("auth").classList.remove("hidden");
  $("workspace").classList.add("hidden");
  $("logout").classList.add("hidden");
  $("messages").replaceChildren();
  $("people").replaceChildren();
  $("text").value = "";

  clearFile();
}

async function showWorkspace(account) {
  generation++;
  clearInterval(timer);
  user = account;
  lastSnapshot = "";

  $("auth").classList.add("hidden");
  $("workspace").classList.remove("hidden");
  $("logout").classList.remove("hidden");

  $("profileName").value = user.name;
  $("profession").value = user.profession;
  $("bio").value = user.bio;
  $("avatar").textContent = user.name[0].toUpperCase();

  await refresh();

  timer = setInterval(() => {
    if (!document.hidden) {
      refresh().catch(reportError);
    }
  }, 2000);
}

async function refresh() {
  if (!user || refreshBusy) return;

  refreshBusy = true;
  const currentGeneration = generation;

  try {
    const [accounts, messages] = await Promise.all([
      getUsers(),
      getMessages()
    ]);

    if (!user || currentGeneration !== generation) return;

    const names = new Map(
      accounts.map((account) => [account.email, account.name])
    );

    const snapshot = JSON.stringify({
      people: accounts.map((account) => [
        account.email,
        account.name,
        account.profession,
        account.bio
      ]),
      messages: messages.map((message) => [
        message.id,
        message.email,
        message.text,
        message.createdAt,
        message.file?.name,
        message.file?.size
      ]),
      current: user.email
    });

    if (snapshot === lastSnapshot) return;
    lastSnapshot = snapshot;

    renderPeople(accounts);
    renderMessages(messages, names);
  } finally {
    refreshBusy = false;
  }
}

function renderPeople(accounts) {
  $("people").replaceChildren();

  accounts.sort((a, b) => a.name.localeCompare(b.name, "ru"));

  for (const account of accounts) {
    const row = element("div", undefined, "person");
    const avatar = element(
      "div",
      account.name[0].toUpperCase(),
      "small-avatar"
    );

    const description = element("div");
    description.append(element(
      "strong",
      account.name + (account.email === user.email ? " · ты" : "")
    ));

    description.append(element(
      "small",
      account.profession || "Участник сообщества"
    ));

    if (account.bio) {
      description.title = account.bio;
    }

    row.append(avatar, description);
    $("people").append(row);
  }
}

function renderMessages(messages, names) {
  const container = $("messages");

  const nearBottom =
    container.scrollHeight -
    container.scrollTop -
    container.clientHeight < 100;

  const firstRender = !container.children.length;

  container.replaceChildren();

  if (!messages.length) {
    container.append(element(
      "div",
      "Здесь пока тихо. Отправь первое сообщение!",
      "empty"
    ));
    return;
  }

  for (const message of messages) {
    const own = message.email === user.email;

    const row = element(
      "article",
      undefined,
      own ? "message own" : "message"
    );

    const top = element("div", undefined, "message-top");
    top.append(element(
      "strong",
      names.get(message.email) || "Участник"
    ));

    if (own) {
      const remove = element("button", "Удалить", "text-button");
      remove.type = "button";

      remove.onclick = async () => {
        remove.disabled = true;

        try {
          // Это проверка интерфейса демонстрации, не серверная защита.
          if (!user || message.email !== user.email) return;

          await storeRequest(
            "messages",
            "readwrite",
            (store) => store.delete(message.id)
          );

          await refresh();
        } catch (error) {
          reportError(error);
        } finally {
          remove.disabled = false;
        }
      };

      top.append(remove);
    }

    row.append(top);

    if (message.text) {
      row.append(element("p", message.text));
    }

    if (message.file) {
      const size = (message.file.size / 1024).toFixed(0);

      const download = element(
        "button",
        `📎 ${message.file.name} · ${size} КБ`,
        "attachment"
      );

      download.type = "button";
      download.onclick = () => {
        const url = URL.createObjectURL(message.file);
        const link = document.createElement("a");

        link.href = url;
        link.download = message.file.name;
        document.body.append(link);
        link.click();
        link.remove();

        setTimeout(() => URL.revokeObjectURL(url), 60000);
      };

      row.append(download);
    }

    const time = element(
      "time",
      new Date(message.createdAt).toLocaleString("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
      }),
      "muted"
    );

    time.dateTime = message.createdAt;
    row.append(time);

    container.append(row);
  }

  if (nearBottom || firstRender) {
    container.scrollTop = container.scrollHeight;
  }
}

$("switchAuth").onclick = () => {
  registerMode = !registerMode;

  $("nameField").classList.toggle("hidden", !registerMode);
  $("name").required = registerMode;

  $("authTitle").textContent = registerMode
    ? "Создай свой аккаунт"
    : "С возвращением";

  $("authSubmit").textContent = registerMode
    ? "Зарегистрироваться"
    : "Войти";

  $("switchAuth").textContent = registerMode
    ? "У меня уже есть аккаунт"
    : "Создать аккаунт";

  $("password").autocomplete = registerMode
    ? "new-password"
    : "current-password";
};

$("authForm").onsubmit = async (event) => {
  event.preventDefault();
  if (!database) return notify("База данных ещё не готова.");

  $("authSubmit").disabled = true;
  $("switchAuth").disabled = true;

  try {
    const email = $("email").value.trim().toLowerCase();
    const password = $("password").value;
    let account = await getUser(email);

    if (registerMode) {
      const name = $("name").value.trim();

      if (name.length < 2) {
        throw new Error("Имя должно содержать минимум 2 символа.");
      }

      if (account) {
        throw new Error("Этот email уже зарегистрирован в этом браузере.");
      }

      const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));

      account = {
        email,
        name,
        profession: "",
        bio: "",
        salt,
        passwordHash: await passwordHash(password, salt)
      };

      await storeRequest(
        "users",
        "readwrite",
        (store) => store.add(account)
      );
    } else {
      if (
        !account ||
        await passwordHash(password, account.salt) !== account.passwordHash
      ) {
        throw new Error("Неверный email или пароль.");
      }
    }

    // Вход сохраняется только в этой вкладке.
    sessionStorage.setItem(SESSION_KEY, email);
    $("password").value = "";

    await showWorkspace(account);
  } catch (error) {
    reportError(error);
  } finally {
    $("authSubmit").disabled = false;
    $("switchAuth").disabled = false;
  }
};

$("profileForm").onsubmit = async (event) => {
  event.preventDefault();
  if (!user) return;

  const button = event.currentTarget.querySelector("button");
  button.disabled = true;

  try {
    const name = $("profileName").value.trim();

    if (name.length < 2) {
      throw new Error("Имя должно содержать минимум 2 символа.");
    }

    const updated = {
      ...user,
      name,
      profession: $("profession").value.trim(),
      bio: $("bio").value.trim()
    };

    await storeRequest(
      "users",
      "readwrite",
      (store) => store.put(updated)
    );

    user = updated;
    $("avatar").textContent = user.name[0].toUpperCase();

    await refresh();
    notify("Профиль сохранён.");
  } catch (error) {
    reportError(error);
  } finally {
    button.disabled = false;
  }
};

$("file").onchange = () => {
  const file = $("file").files[0];

  if (!file) {
    clearFile();
    return;
  }

  const extension = file.name.split(".").pop().toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    clearFile();
    return notify("Этот формат не поддерживается.");
  }

  if (file.size > 10 * 1024 * 1024) {
    clearFile();
    return notify("Максимальный размер файла — 10 МБ.");
  }

  $("fileLabel").textContent = file.name;
  $("clearFile").classList.remove("hidden");
};

$("clearFile").onclick = clearFile;

$("messageForm").onsubmit = async (event) => {
  event.preventDefault();
  if (!user) return;

  const text = $("text").value.trim();
  const file = $("file").files[0] || null;

  if (!text && !file) {
    return notify("Напиши сообщение или выбери файл.");
  }

  if (text.length > 3000) {
    return notify("Максимум 3000 символов.");
  }

  if (file) {
    const extension = file.name.split(".").pop().toLowerCase();

    if (
      !ALLOWED_EXTENSIONS.has(extension) ||
      file.size > 10 * 1024 * 1024
    ) {
      return notify("Проверь формат и размер файла.");
    }
  }

  $("send").disabled = true;

  try {
    await storeRequest(
      "messages",
      "readwrite",
      (store) => store.add({
        email: user.email,
        text,
        file,
        createdAt: new Date().toISOString()
      })
    );

    $("text").value = "";
    clearFile();

    await refresh();
    $("messages").scrollTop = $("messages").scrollHeight;
  } catch (error) {
    reportError(error);
  } finally {
    $("send").disabled = false;
  }
};

$("logout").onclick = () => {
  sessionStorage.removeItem(SESSION_KEY);
  showAuth();
};

async function init() {
  $("authSubmit").disabled = true;

  try {
    if (!window.indexedDB || !window.crypto?.subtle) {
      throw new Error(
        "Открой сайт через HTTPS на GitHub Pages в современном браузере."
      );
    }

    database = await openDatabase();

    const email = sessionStorage.getItem(SESSION_KEY);
    const account = email ? await getUser(email) : null;

    if (account) {
      await showWorkspace(account);
    } else {
      sessionStorage.removeItem(SESSION_KEY);
      showAuth();
    }
  } catch (error) {
    reportError(error);
  } finally {
    $("authSubmit").disabled = !database;
  }
}

init();
