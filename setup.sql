begin;

-- Профили пользователей.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null
    check (char_length(trim(name)) between 2 and 60),
  profession text not null default ''
    check (char_length(profession) <= 100)
);

-- Общий чат.
create table public.messages (
  id bigint generated always as identity primary key,
  user_id uuid not null
    references public.profiles(id) on delete cascade,
  body text not null default ''
    check (char_length(body) <= 3000),
  file_path text,
  file_name text,
  created_at timestamptz not null default now(),

  constraint message_not_empty check (
    char_length(trim(body)) > 0 or file_path is not null
  ),

  constraint valid_attachment check (
    (file_path is null and file_name is null)
    or
    (
      file_path is not null
      and file_name is not null
      and char_length(file_name) between 1 and 180
      and split_part(file_path, '/', 1) = user_id::text
      and file_path ~
        '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|txt|png|jpg|jpeg|webp|zip)$'
    )
  )
);

create index messages_chronology
  on public.messages (created_at desc, id desc);

-- Запрет доступа без правил RLS.
alter table public.profiles enable row level security;
alter table public.messages enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.messages from anon, authenticated;

grant select, insert on public.profiles to authenticated;
grant update (name, profession) on public.profiles to authenticated;

grant select on public.messages to authenticated;
grant insert (user_id, body, file_path, file_name)
  on public.messages to authenticated;

grant usage on sequence public.messages_id_seq to authenticated;

-- Профили видны участникам.
create policy "Members read profiles"
on public.profiles for select
to authenticated
using (true);

-- Создать можно только собственный профиль.
create policy "Members create own profile"
on public.profiles for insert
to authenticated
with check ((select auth.uid()) = id);

-- Редактировать можно только собственный профиль.
create policy "Members edit own profile"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

-- Чат виден только вошедшим пользователям.
create policy "Members read messages"
on public.messages for select
to authenticated
using (true);

-- Нельзя отправить сообщение от чужого имени.
create policy "Members send own messages"
on public.messages for insert
to authenticated
with check ((select auth.uid()) = user_id);

-- Закрытое хранилище файлов: максимум 10 МБ.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'udalenka-files',
  'udalenka-files',
  false,
  10485760,
  array[
    'application/pdf',
    'text/plain',
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/zip'
  ]
);

-- Вложения общего чата доступны всем вошедшим участникам.
create policy "Members download chat files"
on storage.objects for select
to authenticated
using (bucket_id = 'udalenka-files');

-- Загружать файлы можно только в собственную папку.
create policy "Members upload own files"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'udalenka-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- Удаление нужно для очистки вложения при ошибке отправки.
create policy "Members remove own files"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'udalenka-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

commit;
