-- Migration 008: Add ai_settings column to profiles table for admin API key synchronization
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ai_settings JSONB DEFAULT '{}';
