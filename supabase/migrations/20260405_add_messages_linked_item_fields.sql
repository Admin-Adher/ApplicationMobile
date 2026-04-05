-- Migration: Ajoute les colonnes linked_item_type, linked_item_id, linked_item_title à messages
-- Date: 2026-04-05
-- Problème: Le code insère ces champs mais la table ne les avait pas,
--           ce qui causait l'erreur "Le message n'a pas pu être envoyé" pour TOUS les messages.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS linked_item_type  text,
  ADD COLUMN IF NOT EXISTS linked_item_id    text,
  ADD COLUMN IF NOT EXISTS linked_item_title text;
