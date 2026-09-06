/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_SOCKET_URL: string;
	readonly VITE_API_URL: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

declare namespace JSX {
	interface IntrinsicElements {
		'lottie-player': {
			src?: string;
			background?: string;
			speed?: string | number;
			loop?: boolean;
			autoplay?: boolean;
			style?: React.CSSProperties;
		};
	}
}
