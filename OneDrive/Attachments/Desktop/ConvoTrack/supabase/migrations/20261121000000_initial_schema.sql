
-- Enable required extensions first
create schema if not exists extensions;

create extension if not exists vector
with schema extensions;

create extension if not exists pgcrypto;

-- Meetings table
create table if not exists public.meetings (
    id uuid primary key default gen_random_uuid(),
    created_by uuid references auth.users(id) on delete cascade not null,
    title text not null,
    audio_path text,
    transcript text,
    embedding extensions.vector(1536),
    created_at timestamptz default now()
);

-- Action items table
create table if not exists public.action_items (
    id uuid primary key default gen_random_uuid(),
    meeting_id uuid references public.meetings(id) on delete cascade not null,
    title text not null,
    description text,
    status text default 'pending',
    due_at timestamptz,
    assigned_to uuid references auth.users(id) on delete set null,
    created_at timestamptz default now()
);

-- Clarifications table
create table if not exists public.clarifications (
    id uuid primary key default gen_random_uuid(),
    action_item_id uuid references public.action_items(id) on delete cascade,
    question text not null,
    answer text,
    status text default 'pending',
    created_at timestamptz default now()
);

-- Followups table
create table if not exists public.followups (
    id uuid primary key default gen_random_uuid(),
    action_item_id uuid references public.action_items(id) on delete cascade,
    channel text default 'webhook',
    sent_at timestamptz,
    created_at timestamptz default now()
);
