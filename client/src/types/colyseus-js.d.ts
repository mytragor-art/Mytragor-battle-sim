declare module "colyseus.js" {
	// Tipagem mínima só para remover o erro de módulo.
	// Você pode refinar depois conforme precisar.

	export class Client {
		constructor(endpoint: string);
		joinOrCreate<T = any>(roomName: string, options?: any): Promise<Room<T>>;
		create<T = any>(roomName: string, options?: any): Promise<Room<T>>;
		joinById<T = any>(roomId: string, options?: any): Promise<Room<T>>;
	}

	export class Room<T = any> {
		onStateChange(callback: (state: T) => void): void;
		onLeave(callback: (code: number) => void): void;
		send(type: string, message: any): void;
		onMessage(type: string, callback: (message: any) => void): void;
		readonly id: string;
	}
}

