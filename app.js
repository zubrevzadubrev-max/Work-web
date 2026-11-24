// Настройки из вашего проекта Supabase.
const SUPABASE_URL = "ВСТАВЬ_URL_ПРОЕКТА";
const SUPABASE_KEY = "ВСТАВЬ_PUBLISHABLE_KEY";

// Здесь допустим только publishable key или старый anon key.
// Не вставляйте secret key или service_role key.

const $ = (id) => document.getElementById(id);
const BUCKET = "udalenka-files";
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const FILE_TYPES = {
  pdf: "application/pdf",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  zip: "application/zip"
};

let client;
let currentUser = null;
let registerMode = false;
let pollingTimer;
let noticeTimer;
let refreshing = false;
let version = 0;
let lastMessages = "";

function notify(text) {
  $("notice").textContent = text;
  $("notice").classList.remove("hidden");

  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    $("notice").classList.add("hidden");
  }, 6000);
}

function readableError(error) {
  const text = error?.message || "Не удалось выполнить действие";

  if (text.includes("Invalid login credentials")) {
    return "Неверный email или пароль";
  }

  if (text.includes("Email not confirmed")) {
    return "Подтверди email по ссылке из письма";
  }

  if (text.includes("User already registered")) {
    return "Этот email уже зарегистрирован";
  }

  if (text.includes("rate limit")) {
    return "Слишком много запросов. Попробуй немного позже";
  }

  if (text.includes("Failed to fetch")) {
    return "Не удалось подключиться. Проверь интернет и настройки Supabase";
  }

  return text;
}

function node(tag, text, className) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (className) item.className = className;
  return item;
}

function showLoggedOut() {
  version++;
  currentUser = null;
  clearInterval(pollingTimer);

  $("workspace").classList.add("hidden");
  $("logout").classList.add("hidden");
  $("auth").classList.remove("hidden");
  $("messages").replaceChildren();
  $("people").replaceChildren();

  lastMessages = "";
}

async function activate(user) {
  const ownVersion = ++version;
  currentUser = user;
  clearInterval(pollingTimer);
  lastMessages = "";

  $("auth").classList.add("hidden");
  $("logout").classList.remove("hidden");
  $("workspace").classList.remove("hidden");

  let { data: profile, error } = await client
    .from("profiles")
    .select("id,name,profession")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw error;

  // Профиль создаётся только после входа / подтверждения email.
  if (!profile) {
    const metadataName = String(user.user_metadata?.name || "").trim();
    const name = metadataName.length >= 2
      ? metadataName.slice(0, 60)
      : "Участник";

    const result = await client
      .from("profiles")
      .upsert({
        id: user.id,
        name,
        profession: ""
      }, { onConflict: "id", ignoreDuplicates: true });

    if (result.error) throw result.error;

    const resultProfile = await client
      .from("profiles")
      .select("id,name,profession")
      .eq("id", user.id)
      .single();

    if (resultProfile.error) throw resultProfile.error;
    profile = resultProfile.data;
  }

  if (ownVersion !== version) return;

  $("profileName").value = profile.name;
  $("profession").value = profile.profession;

  await refresh(ownVersion);

  if (ownVersion === version) {
    pollingTimer = setInterval(() => {
      if (!document.hidden) {
        refresh(ownVersion).catch((error) => {
          clearInterval(pollingTimer);
          notify("Обновление остановлено: " + readableError(error));
        });
      }
    }, 3000);
  }
}

async function refresh(expectedVersion = version) {
  if (!currentUser || refreshing) return;
  refreshing = true;

  try {
    const [peopleResult, messagesResult] = await Promise.all([
      client
        .from("profiles")
        .select("id,name,profession")
        .order("name")
        .limit(200),

      client
        .from("messages")
        .select(`
          id,body,file_path,file_name,created_at,user_id,
          profiles(name)
        `)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(100)
    ]);

    if (peopleResult.error) throw peopleResult.error;
    if (messagesResult.error) throw messagesResult.error;
    if (expectedVersion !== version) return;

    renderPeople(peopleResult.data);
    renderMessages([...messagesResult.data].reverse());
  } finally {
    refreshing = false;
  }
}

function renderPeople(people) {
  $("people").replaceChildren();

  if (!people.length) {
    $("people").append(node("p", "Участников пока нет", "muted"));
  }

  for (const person of people) {
    const item = node("div", undefined, "person");
    item.append(node("strong", person.name));
    item.append(node(
      "small",
      person.profession || "Участник сообщества"
    ));
    $("people").append(item);
  }
}

function renderMessages(messages) {
  const snapshot = JSON.stringify(messages);
  if (snapshot === lastMessages) return;

  lastMessages = snapshot;

  const container = $("messages");
  const nearBottom =
    container.scrollHeight - container.scrollTop - container.clientHeight < 100;
  const firstRender = !container.children.length;

  container.replaceChildren();

  if (!messages.length) {
    container.append(node(
      "p",
      "Пока нет сообщений. Начни разговор первым!",
      "muted"
    ));
  }

  for (const message of messages) {
    const item = node("article", undefined, "message");
    item.append(node("strong", message.profiles?.name || "Участник"));

    item.append(node(
      "time",
      new Date(message.created_at).toLocaleString("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
      })
    ));

    if (message.body) {
      item.append(node("p", message.body));
    }

    if (message.file_path) {
      const button = node(
        "button",
        "📎 " + message.file_name,
        "attachment"
      );

      button.type = "button";
      button.onclick = () => downloadFile(message, button);
      item.append(button);
    }

    container.append(item);
  }

  if (nearBottom || firstRender) {
    container.scrollTop = container.scrollHeight;
  }
}

async function downloadFile(message, button) {
  button.disabled = true;

  try {
    const { data, error } = await client.storage
      .from(BUCKET)
      .download(message.file_path);

    if (error) throw error;

    const url = URL.createObjectURL(data);
    const link = document.createElement("a");
    link.href = url;
    link.download = message.file_name;
    document.body.append(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    notify(readableError(error));
  } finally {
    button.disabled = false;
  }
}

$("switchAuth").onclick = () => {
  registerMode = !registerMode;

  $("nameField").classList.toggle("hidden", !registerMode);
  $("name").required = registerMode;

  $("authTitle").textContent = registerMode
    ? "Присоединяйся к сообществу"
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
  $("authSubmit").disabled = true;

  try {
    const email = $("email").value.trim();
    const password = $("password").value;
    let result;

    if (registerMode) {
      const name = $("name").value.trim();

      if (name.length < 2) {
        throw new Error("Введите имя от 2 символов");
      }

      result = await client.auth.signUp({
        email,
        password,
        options: {
          data: { name },
          emailRedirectTo: location.origin + location.pathname
        }
      });
    } else {
      result = await client.auth.signInWithPassword({ email, password });
    }

    if (result.error) throw result.error;

    $("password").value = "";

    if (result.data.session) {
      await activate(result.data.user);
    } else {
      notify("Проверь почту и перейди по ссылке подтверждения email.");
    }
  } catch (error) {
    notify(readableError(error));
  } finally {
    $("authSubmit").disabled = false;
  }
};

$("profileForm").onsubmit = async (event) => {
  event.preventDefault();
  if (!currentUser) return;

  const button = event.currentTarget.querySelector("button");
  button.disabled = true;

  try {
    const name = $("profileName").value.trim();
    const profession = $("profession").value.trim();

    if (name.length < 2) throw new Error("Имя должно содержать от 2 символов");

    const { error } = await client
      .from("profiles")
      .update({ name, profession })
      .eq("id", currentUser.id);

    if (error) throw error;

    await refresh();
    notify("Профиль сохранён");
  } catch (error) {
    notify(readableError(error));
  } finally {
    button.disabled = false;
  }
};

$("messageForm").onsubmit = async (event) => {
  event.preventDefault();
  if (!currentUser) return;

  const userId = currentUser.id;
  const body = $("text").value.trim();
  const file = $("file").files[0];

  if (!body && !file) return notify("Напиши сообщение или прикрепи файл");
  if (body.length > 3000) return notify("Максимум 3000 символов");

  let extension;
  if (file) {
    extension = file.name.split(".").pop().toLowerCase();

    if (!FILE_TYPES[extension]) {
      return notify("Этот формат файла не поддерживается");
    }

    if (file.size > MAX_FILE_SIZE) {
      return notify("Максимальный размер файла — 10 МБ");
    }

    if (file.size === 0) return notify("Нельзя отправить пустой файл");
  }

  $("send").disabled = true;
  let uploadedPath = null;
  let committed = false;

  try {
    if (file) {
      uploadedPath = `${userId}/${crypto.randomUUID()}.${extension}`;

      const { error } = await client.storage
        .from(BUCKET)
        .upload(uploadedPath, file, {
          contentType: FILE_TYPES[extension],
          upsert: false
        });

      if (error) {
        uploadedPath = null;
        throw error;
      }
    }

    const { error } = await client.from("messages").insert({
      user_id: userId,
      body,
      file_path: uploadedPath,
      file_name: file ? file.name.slice(0, 180) : null
    });

    if (error) throw error;
    committed = true;

    $("text").value = "";
    $("file").value = "";

    await refresh();
    $("messages").scrollTop = $("messages").scrollHeight;
  } catch (error) {
    if (uploadedPath && !committed) {
      const cleanup = await client.storage.from(BUCKET).remove([uploadedPath]);
      if (cleanup.error) console.error("Не удалось убрать вложение", cleanup.error);
    }

    notify(committed
      ? "Сообщение отправлено, но чат не обновился. Обнови страницу."
      : readableError(error));
  } finally {
    $("send").disabled = false;
  }
};

$("logout").onclick = async () => {
  try {
    const { error } = await client.auth.signOut();
    if (error) throw error;
    showLoggedOut();
  } catch (error) {
    notify(readableError(error));
  }
};

async function init() {
  if (
    !SUPABASE_URL.startsWith("https://") ||
    SUPABASE_KEY.includes("ВСТАВЬ")
  ) {
    $("setup").classList.remove("hidden");
    return;
  }

  if (!window.supabase) {
    throw new Error("Не загрузилась библиотека Supabase. Обнови страницу.");
  }

  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  client.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") showLoggedOut();
  });

  const { data, error } = await client.auth.getSession();
  if (error) throw error;

  if (data.session) {
    await activate(data.session.user);
  } else {
    showLoggedOut();
  }
}

init().catch((error) => notify(readableError(error)));
