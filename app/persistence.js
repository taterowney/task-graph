"use client";

import { useEffect, useRef, useState } from "react";

export const STORAGE_KEY = "taskgraph:userData";

function isBrowser() {
	return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

// Ensure only root and its immediate children are visible on first load
export function normalizeVisibilityOnFirstLoad(data) {
	const next = {};
	for (const [id, node] of Object.entries(data || {})) {
		next[id] = { ...node, visible: false };
	}
	if (next.root) {
		next.root.visible = true;
		const kids = Array.isArray(next.root.children) ? next.root.children : [];
		for (const cid of kids) {
			if (next[cid]) next[cid].visible = true;
		}
	}
	return next;
}

export function loadUserData(defaultData, key = STORAGE_KEY) {
	if (!isBrowser()) return defaultData;
	try {
		const raw = window.localStorage.getItem(key);
		if (raw) {
			const initial = normalizeVisibilityOnFirstLoad(JSON.parse(raw));
            window.localStorage.setItem(key, JSON.stringify(initial));
            return initial;
		}
		const initial = normalizeVisibilityOnFirstLoad(defaultData);
		window.localStorage.setItem(key, JSON.stringify(initial));
		return initial;
	} catch (e) {
		console.warn("Failed to load userData from localStorage:", e);
		return defaultData;
	}
}

export function saveUserData(data, key = STORAGE_KEY) {
	if (!isBrowser()) return;
	try {
		window.localStorage.setItem(key, JSON.stringify(data));
	} catch (e) {
		console.warn("Failed to save userData to localStorage:", e);
	}
}

// React hook to persist userData to localStorage
export function usePersistentUserData(defaultData, key = STORAGE_KEY) {
	const [data, setData] = useState(defaultData);
	const [isLoaded, setIsLoaded] = useState(false);
	const loadedRef = useRef(false);

	// Load once on mount
	useEffect(() => {
		const loaded = loadUserData(defaultData, key);
		loadedRef.current = true;
		setData(loaded);
		setIsLoaded(true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key]);

	// Save whenever data changes after initial load
	useEffect(() => {
		if (!loadedRef.current) return;
		saveUserData(data, key);
	}, [data, key]);

	return [data, setData, isLoaded];
}

