import path from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

export const storageStatePath: string = path.resolve(currentDirectory, '.playwright/.storage-state.json')
