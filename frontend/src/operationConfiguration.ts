export type ApiParameter = {
  name: string
  location: string
  required: boolean
  example: unknown
}

export type Operation = {
  operationId: string
  method: string
  path: string
  summary: string
  destructive: boolean
  parameters: ApiParameter[]
  requestBodyExample: unknown
  hasRequestBody: boolean
  requestBodyRequired: boolean
  bearerAuth: boolean
}

export type ImportedSpecification = {
  title: string
  version: string
  baseUrl: string
  operations: Operation[]
}

export type OperationSettings = {
  parameterValues: Record<string, string>
  requestBodyJson: string
  bearerToken: string
}

export type OperationConfiguration = {
  operationId: string
  parameterValues: Array<{ name: string, location: string, value: string }>
  requestBodyJson?: string
  bearerToken?: string
}

export function parameterKey(parameter: Pick<ApiParameter, 'location' | 'name'>): string {
  return `${parameter.location}:${parameter.name}`
}

export function createOperationSettings(operations: Operation[]): Record<string, OperationSettings> {
  return Object.fromEntries(operations.map(operation => [
    operation.operationId,
    {
      parameterValues: Object.fromEntries(operation.parameters.map(parameter => [parameterKey(parameter), formatExample(parameter.example)])),
      requestBodyJson: operation.requestBodyExample == null ? '' : JSON.stringify(operation.requestBodyExample, null, 2),
      bearerToken: '',
    },
  ]))
}

export function buildOperationConfigurations(
  operations: Operation[],
  selected: Set<string>,
  settingsByOperationId: Record<string, OperationSettings>,
): OperationConfiguration[] {
  return operations.filter(operation => selected.has(operation.operationId)).map(operation => {
    const settings = settingsByOperationId[operation.operationId]
    if (!settings) throw new Error(`Konfiguration für ${operation.operationId} fehlt.`)

    const parameterValues = operation.parameters.map(parameter => {
      const value = settings.parameterValues[parameterKey(parameter)] ?? ''
      if (parameter.required && value.trim() === '') {
        throw new Error(`Pflichtparameter „${parameter.name}“ für ${operation.operationId} darf nicht leer sein.`)
      }
      return { name: parameter.name, location: parameter.location, value }
    })

    const requestBodyJson = operation.hasRequestBody ? settings.requestBodyJson : undefined
    if (operation.requestBodyRequired && requestBodyJson?.trim() === '') {
      throw new Error(`Pflicht-Request-Body für ${operation.operationId} darf nicht leer sein.`)
    }
    if (requestBodyJson?.trim()) {
      try {
        JSON.parse(requestBodyJson)
      } catch {
        throw new Error(`Request-Body für ${operation.operationId} ist kein gültiges JSON.`)
      }
    }

    return {
      operationId: operation.operationId,
      parameterValues,
      requestBodyJson,
      bearerToken: settings.bearerToken.trim() || undefined,
    }
  })
}

function formatExample(example: unknown): string {
  if (example == null) return ''
  if (typeof example === 'object') return JSON.stringify(example)
  return String(example)
}
