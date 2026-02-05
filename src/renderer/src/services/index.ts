import { isElectron } from '@/lib/env'
import { createStorageService } from './storageService'
import { createFileService } from './fileService'

export const storageService = createStorageService()
export const fileService = createFileService(isElectron())
