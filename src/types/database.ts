export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5'
  }
  public: {
    Tables: {
      agendas_diarias: {
        Row: {
          created_at: string
          estado_general: Database['public']['Enums']['estado_general_agenda'] | null
          fecha: string
          humor: Database['public']['Enums']['humor_agenda'] | null
          id: string
          nino_id: string
          observaciones_generales: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          estado_general?: Database['public']['Enums']['estado_general_agenda'] | null
          fecha: string
          humor?: Database['public']['Enums']['humor_agenda'] | null
          id?: string
          nino_id: string
          observaciones_generales?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          estado_general?: Database['public']['Enums']['estado_general_agenda'] | null
          fecha?: string
          humor?: Database['public']['Enums']['humor_agenda'] | null
          id?: string
          nino_id?: string
          observaciones_generales?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'agendas_diarias_nino_id_fkey'
            columns: ['nino_id']
            isOneToOne: false
            referencedRelation: 'ninos'
            referencedColumns: ['id']
          },
        ]
      }
      asistencias: {
        Row: {
          created_at: string
          estado: Database['public']['Enums']['estado_asistencia']
          fecha: string
          hora_llegada: string | null
          hora_salida: string | null
          id: string
          nino_id: string
          observaciones: string | null
          registrada_por: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          estado: Database['public']['Enums']['estado_asistencia']
          fecha: string
          hora_llegada?: string | null
          hora_salida?: string | null
          id?: string
          nino_id: string
          observaciones?: string | null
          registrada_por?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          estado?: Database['public']['Enums']['estado_asistencia']
          fecha?: string
          hora_llegada?: string | null
          hora_salida?: string | null
          id?: string
          nino_id?: string
          observaciones?: string | null
          registrada_por?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'asistencias_nino_id_fkey'
            columns: ['nino_id']
            isOneToOne: false
            referencedRelation: 'ninos'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'asistencias_registrada_por_fkey'
            columns: ['registrada_por']
            isOneToOne: false
            referencedRelation: 'usuarios'
            referencedColumns: ['id']
          },
        ]
      }
      audit_log: {
        Row: {
          accion: Database['public']['Enums']['audit_accion']
          centro_id: string | null
          id: string
          registro_id: string | null
          tabla: string
          ts: string
          usuario_id: string | null
          valores_antes: Json | null
          valores_despues: Json | null
        }
        Insert: {
          accion: Database['public']['Enums']['audit_accion']
          centro_id?: string | null
          id?: string
          registro_id?: string | null
          tabla: string
          ts?: string
          usuario_id?: string | null
          valores_antes?: Json | null
          valores_despues?: Json | null
        }
        Update: {
          accion?: Database['public']['Enums']['audit_accion']
          centro_id?: string | null
          id?: string
          registro_id?: string | null
          tabla?: string
          ts?: string
          usuario_id?: string | null
          valores_antes?: Json | null
          valores_despues?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: 'audit_log_usuario_id_fkey'
            columns: ['usuario_id']
            isOneToOne: false
            referencedRelation: 'usuarios'
            referencedColumns: ['id']
          },
        ]
      }
      aulas: {
        Row: {
          capacidad_maxima: number
          centro_id: string
          cohorte_anos_nacimiento: number[]
          created_at: string
          curso_academico_id: string
          deleted_at: string | null
          descripcion: string | null
          id: string
          nombre: string
          updated_at: string
        }
        Insert: {
          capacidad_maxima?: number
          centro_id: string
          cohorte_anos_nacimiento: number[]
          created_at?: string
          curso_academico_id: string
          deleted_at?: string | null
          descripcion?: string | null
          id?: string
          nombre: string
          updated_at?: string
        }
        Update: {
          capacidad_maxima?: number
          centro_id?: string
          cohorte_anos_nacimiento?: number[]
          created_at?: string
          curso_academico_id?: string
          deleted_at?: string | null
          descripcion?: string | null
          id?: string
          nombre?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'aulas_centro_id_fkey'
            columns: ['centro_id']
            isOneToOne: false
            referencedRelation: 'centros'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'aulas_curso_academico_id_fkey'
            columns: ['curso_academico_id']
            isOneToOne: false
            referencedRelation: 'cursos_academicos'
            referencedColumns: ['id']
          },
        ]
      }
      ausencias: {
        Row: {
          created_at: string
          descripcion: string | null
          fecha_fin: string
          fecha_inicio: string
          id: string
          motivo: Database['public']['Enums']['motivo_ausencia']
          nino_id: string
          reportada_por: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          descripcion?: string | null
          fecha_fin: string
          fecha_inicio: string
          id?: string
          motivo: Database['public']['Enums']['motivo_ausencia']
          nino_id: string
          reportada_por?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          descripcion?: string | null
          fecha_fin?: string
          fecha_inicio?: string
          id?: string
          motivo?: Database['public']['Enums']['motivo_ausencia']
          nino_id?: string
          reportada_por?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'ausencias_nino_id_fkey'
            columns: ['nino_id']
            isOneToOne: false
            referencedRelation: 'ninos'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ausencias_reportada_por_fkey'
            columns: ['reportada_por']
            isOneToOne: false
            referencedRelation: 'usuarios'
            referencedColumns: ['id']
          },
        ]
      }
      auth_attempts: {
        Row: {
          created_at: string
          email_hash: string
          id: string
          ip_hash: string
          success: boolean
        }
        Insert: {
          created_at?: string
          email_hash: string
          id?: string
          ip_hash: string
          success: boolean
        }
        Update: {
          created_at?: string
          email_hash?: string
          id?: string
          ip_hash?: string
          success?: boolean
        }
        Relationships: []
      }
      biberones: {
        Row: {
          agenda_id: string
          cantidad_ml: number
          created_at: string
          hora: string
          id: string
          observaciones: string | null
          tipo: Database['public']['Enums']['tipo_biberon']
          tomado_completo: boolean
          updated_at: string
        }
        Insert: {
          agenda_id: string
          cantidad_ml: number
          created_at?: string
          hora: string
          id?: string
          observaciones?: string | null
          tipo: Database['public']['Enums']['tipo_biberon']
          tomado_completo?: boolean
          updated_at?: string
        }
        Update: {
          agenda_id?: string
          cantidad_ml?: number
          created_at?: string
          hora?: string
          id?: string
          observaciones?: string | null
          tipo?: Database['public']['Enums']['tipo_biberon']
          tomado_completo?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'biberones_agenda_id_fkey'
            columns: ['agenda_id']
            isOneToOne: false
            referencedRelation: 'agendas_diarias'
            referencedColumns: ['id']
          },
        ]
      }
      centros: {
        Row: {
          created_at: string
          deleted_at: string | null
          direccion: string
          email_contacto: string
          id: string
          idioma_default: string
          logo_url: string | null
          nombre: string
          telefono: string
          updated_at: string
          web: string | null
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          direccion: string
          email_contacto: string
          id?: string
          idioma_default?: string
          logo_url?: string | null
          nombre: string
          telefono: string
          updated_at?: string
          web?: string | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          direccion?: string
          email_contacto?: string
          id?: string
          idioma_default?: string
          logo_url?: string | null
          nombre?: string
          telefono?: string
          updated_at?: string
          web?: string | null
        }
        Relationships: []
      }
      comidas: {
        Row: {
          agenda_id: string
          cantidad: Database['public']['Enums']['cantidad_comida']
          created_at: string
          descripcion: string | null
          hora: string | null
          id: string
          momento: Database['public']['Enums']['momento_comida']
          observaciones: string | null
          updated_at: string
        }
        Insert: {
          agenda_id: string
          cantidad: Database['public']['Enums']['cantidad_comida']
          created_at?: string
          descripcion?: string | null
          hora?: string | null
          id?: string
          momento: Database['public']['Enums']['momento_comida']
          observaciones?: string | null
          updated_at?: string
        }
        Update: {
          agenda_id?: string
          cantidad?: Database['public']['Enums']['cantidad_comida']
          created_at?: string
          descripcion?: string | null
          hora?: string | null
          id?: string
          momento?: Database['public']['Enums']['momento_comida']
          observaciones?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'comidas_agenda_id_fkey'
            columns: ['agenda_id']
            isOneToOne: false
            referencedRelation: 'agendas_diarias'
            referencedColumns: ['id']
          },
        ]
      }
      consentimientos: {
        Row: {
          aceptado_en: string
          created_at: string
          id: string
          ip_address: unknown
          tipo: Database['public']['Enums']['consentimiento_tipo']
          user_agent: string | null
          usuario_id: string
          version: string
        }
        Insert: {
          aceptado_en?: string
          created_at?: string
          id?: string
          ip_address?: unknown
          tipo: Database['public']['Enums']['consentimiento_tipo']
          user_agent?: string | null
          usuario_id: string
          version: string
        }
        Update: {
          aceptado_en?: string
          created_at?: string
          id?: string
          ip_address?: unknown
          tipo?: Database['public']['Enums']['consentimiento_tipo']
          user_agent?: string | null
          usuario_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: 'consentimientos_usuario_id_fkey'
            columns: ['usuario_id']
            isOneToOne: false
            referencedRelation: 'usuarios'
            referencedColumns: ['id']
          },
        ]
      }
      cursos_academicos: {
        Row: {
          centro_id: string
          created_at: string
          deleted_at: string | null
          estado: Database['public']['Enums']['curso_estado']
          fecha_fin: string
          fecha_inicio: string
          id: string
          nombre: string
          updated_at: string
        }
        Insert: {
          centro_id: string
          created_at?: string
          deleted_at?: string | null
          estado?: Database['public']['Enums']['curso_estado']
          fecha_fin: string
          fecha_inicio: string
          id?: string
          nombre: string
          updated_at?: string
        }
        Update: {
          centro_id?: string
          created_at?: string
          deleted_at?: string | null
          estado?: Database['public']['Enums']['curso_estado']
          fecha_fin?: string
          fecha_inicio?: string
          id?: string
          nombre?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'cursos_academicos_centro_id_fkey'
            columns: ['centro_id']
            isOneToOne: false
            referencedRelation: 'centros'
            referencedColumns: ['id']
          },
        ]
      }
      datos_pedagogicos_nino: {
        Row: {
          alimentacion_observaciones: string | null
          control_esfinteres: Database['public']['Enums']['control_esfinteres']
          control_esfinteres_observaciones: string | null
          created_at: string
          deleted_at: string | null
          id: string
          idiomas_casa: string[]
          lactancia_estado: Database['public']['Enums']['lactancia_estado']
          lactancia_observaciones: string | null
          nino_id: string
          siesta_horario_habitual: string | null
          siesta_numero_diario: number | null
          siesta_observaciones: string | null
          tiene_hermanos_en_centro: boolean
          tipo_alimentacion: Database['public']['Enums']['tipo_alimentacion']
          updated_at: string
        }
        Insert: {
          alimentacion_observaciones?: string | null
          control_esfinteres: Database['public']['Enums']['control_esfinteres']
          control_esfinteres_observaciones?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          idiomas_casa: string[]
          lactancia_estado: Database['public']['Enums']['lactancia_estado']
          lactancia_observaciones?: string | null
          nino_id: string
          siesta_horario_habitual?: string | null
          siesta_numero_diario?: number | null
          siesta_observaciones?: string | null
          tiene_hermanos_en_centro?: boolean
          tipo_alimentacion: Database['public']['Enums']['tipo_alimentacion']
          updated_at?: string
        }
        Update: {
          alimentacion_observaciones?: string | null
          control_esfinteres?: Database['public']['Enums']['control_esfinteres']
          control_esfinteres_observaciones?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          idiomas_casa?: string[]
          lactancia_estado?: Database['public']['Enums']['lactancia_estado']
          lactancia_observaciones?: string | null
          nino_id?: string
          siesta_horario_habitual?: string | null
          siesta_numero_diario?: number | null
          siesta_observaciones?: string | null
          tiene_hermanos_en_centro?: boolean
          tipo_alimentacion?: Database['public']['Enums']['tipo_alimentacion']
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'datos_pedagogicos_nino_nino_id_fkey'
            columns: ['nino_id']
            isOneToOne: true
            referencedRelation: 'ninos'
            referencedColumns: ['id']
          },
        ]
      }
      deposiciones: {
        Row: {
          agenda_id: string
          cantidad: Database['public']['Enums']['cantidad_deposicion']
          consistencia: Database['public']['Enums']['consistencia_deposicion'] | null
          created_at: string
          hora: string | null
          id: string
          observaciones: string | null
          tipo: Database['public']['Enums']['tipo_deposicion']
          updated_at: string
        }
        Insert: {
          agenda_id: string
          cantidad: Database['public']['Enums']['cantidad_deposicion']
          consistencia?: Database['public']['Enums']['consistencia_deposicion'] | null
          created_at?: string
          hora?: string | null
          id?: string
          observaciones?: string | null
          tipo: Database['public']['Enums']['tipo_deposicion']
          updated_at?: string
        }
        Update: {
          agenda_id?: string
          cantidad?: Database['public']['Enums']['cantidad_deposicion']
          consistencia?: Database['public']['Enums']['consistencia_deposicion'] | null
          created_at?: string
          hora?: string | null
          id?: string
          observaciones?: string | null
          tipo?: Database['public']['Enums']['tipo_deposicion']
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'deposiciones_agenda_id_fkey'
            columns: ['agenda_id']
            isOneToOne: false
            referencedRelation: 'agendas_diarias'
            referencedColumns: ['id']
          },
        ]
      }
      info_medica_emergencia: {
        Row: {
          alergias_graves: string | null
          alergias_leves: string | null
          created_at: string
          id: string
          medicacion_habitual: string | null
          medico_familia: string | null
          nino_id: string
          notas_emergencia: string | null
          telefono_emergencia: string | null
          updated_at: string
        }
        Insert: {
          alergias_graves?: string | null
          alergias_leves?: string | null
          created_at?: string
          id?: string
          medicacion_habitual?: string | null
          medico_familia?: string | null
          nino_id: string
          notas_emergencia?: string | null
          telefono_emergencia?: string | null
          updated_at?: string
        }
        Update: {
          alergias_graves?: string | null
          alergias_leves?: string | null
          created_at?: string
          id?: string
          medicacion_habitual?: string | null
          medico_familia?: string | null
          nino_id?: string
          notas_emergencia?: string | null
          telefono_emergencia?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'info_medica_emergencia_nino_id_fkey'
            columns: ['nino_id']
            isOneToOne: true
            referencedRelation: 'ninos'
            referencedColumns: ['id']
          },
        ]
      }
      invitaciones: {
        Row: {
          accepted_at: string | null
          aula_id: string | null
          centro_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invitado_por: string | null
          nino_id: string | null
          rejected_at: string | null
          rol_objetivo: Database['public']['Enums']['user_role']
          token: string
        }
        Insert: {
          accepted_at?: string | null
          aula_id?: string | null
          centro_id: string
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invitado_por?: string | null
          nino_id?: string | null
          rejected_at?: string | null
          rol_objetivo: Database['public']['Enums']['user_role']
          token?: string
        }
        Update: {
          accepted_at?: string | null
          aula_id?: string | null
          centro_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invitado_por?: string | null
          nino_id?: string | null
          rejected_at?: string | null
          rol_objetivo?: Database['public']['Enums']['user_role']
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: 'invitaciones_aula_id_fkey'
            columns: ['aula_id']
            isOneToOne: false
            referencedRelation: 'aulas'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'invitaciones_centro_id_fkey'
            columns: ['centro_id']
            isOneToOne: false
            referencedRelation: 'centros'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'invitaciones_invitado_por_fkey'
            columns: ['invitado_por']
            isOneToOne: false
            referencedRelation: 'usuarios'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'invitaciones_nino_id_fkey'
            columns: ['nino_id']
            isOneToOne: false
            referencedRelation: 'ninos'
            referencedColumns: ['id']
          },
        ]
      }
      matriculas: {
        Row: {
          aula_id: string
          created_at: string
          curso_academico_id: string
          deleted_at: string | null
          fecha_alta: string
          fecha_baja: string | null
          id: string
          motivo_baja: string | null
          nino_id: string
        }
        Insert: {
          aula_id: string
          created_at?: string
          curso_academico_id: string
          deleted_at?: string | null
          fecha_alta?: string
          fecha_baja?: string | null
          id?: string
          motivo_baja?: string | null
          nino_id: string
        }
        Update: {
          aula_id?: string
          created_at?: string
          curso_academico_id?: string
          deleted_at?: string | null
          fecha_alta?: string
          fecha_baja?: string | null
          id?: string
          motivo_baja?: string | null
          nino_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'matriculas_aula_id_fkey'
            columns: ['aula_id']
            isOneToOne: false
            referencedRelation: 'aulas'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'matriculas_curso_academico_id_fkey'
            columns: ['curso_academico_id']
            isOneToOne: false
            referencedRelation: 'cursos_academicos'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'matriculas_nino_id_fkey'
            columns: ['nino_id']
            isOneToOne: false
            referencedRelation: 'ninos'
            referencedColumns: ['id']
          },
        ]
      }
      ninos: {
        Row: {
          apellidos: string
          centro_id: string
          created_at: string
          deleted_at: string | null
          fecha_nacimiento: string
          foto_url: string | null
          id: string
          idioma_principal: string
          nacionalidad: string | null
          nombre: string
          notas_admin: string | null
          sexo: Database['public']['Enums']['nino_sexo'] | null
          updated_at: string
        }
        Insert: {
          apellidos: string
          centro_id: string
          created_at?: string
          deleted_at?: string | null
          fecha_nacimiento: string
          foto_url?: string | null
          id?: string
          idioma_principal?: string
          nacionalidad?: string | null
          nombre: string
          notas_admin?: string | null
          sexo?: Database['public']['Enums']['nino_sexo'] | null
          updated_at?: string
        }
        Update: {
          apellidos?: string
          centro_id?: string
          created_at?: string
          deleted_at?: string | null
          fecha_nacimiento?: string
          foto_url?: string | null
          id?: string
          idioma_principal?: string
          nacionalidad?: string | null
          nombre?: string
          notas_admin?: string | null
          sexo?: Database['public']['Enums']['nino_sexo'] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'ninos_centro_id_fkey'
            columns: ['centro_id']
            isOneToOne: false
            referencedRelation: 'centros'
            referencedColumns: ['id']
          },
        ]
      }
      profes_aulas: {
        Row: {
          aula_id: string
          created_at: string
          deleted_at: string | null
          es_profe_principal: boolean
          fecha_fin: string | null
          fecha_inicio: string
          id: string
          profe_id: string
        }
        Insert: {
          aula_id: string
          created_at?: string
          deleted_at?: string | null
          es_profe_principal?: boolean
          fecha_fin?: string | null
          fecha_inicio?: string
          id?: string
          profe_id: string
        }
        Update: {
          aula_id?: string
          created_at?: string
          deleted_at?: string | null
          es_profe_principal?: boolean
          fecha_fin?: string | null
          fecha_inicio?: string
          id?: string
          profe_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'profes_aulas_aula_id_fkey'
            columns: ['aula_id']
            isOneToOne: false
            referencedRelation: 'aulas'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'profes_aulas_profe_id_fkey'
            columns: ['profe_id']
            isOneToOne: false
            referencedRelation: 'usuarios'
            referencedColumns: ['id']
          },
        ]
      }
      roles_usuario: {
        Row: {
          centro_id: string
          created_at: string
          deleted_at: string | null
          id: string
          rol: Database['public']['Enums']['user_role']
          usuario_id: string
        }
        Insert: {
          centro_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          rol: Database['public']['Enums']['user_role']
          usuario_id: string
        }
        Update: {
          centro_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          rol?: Database['public']['Enums']['user_role']
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'roles_usuario_centro_id_fkey'
            columns: ['centro_id']
            isOneToOne: false
            referencedRelation: 'centros'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'roles_usuario_usuario_id_fkey'
            columns: ['usuario_id']
            isOneToOne: false
            referencedRelation: 'usuarios'
            referencedColumns: ['id']
          },
        ]
      }
      suenos: {
        Row: {
          agenda_id: string
          calidad: Database['public']['Enums']['calidad_sueno'] | null
          created_at: string
          hora_fin: string | null
          hora_inicio: string
          id: string
          observaciones: string | null
          updated_at: string
        }
        Insert: {
          agenda_id: string
          calidad?: Database['public']['Enums']['calidad_sueno'] | null
          created_at?: string
          hora_fin?: string | null
          hora_inicio: string
          id?: string
          observaciones?: string | null
          updated_at?: string
        }
        Update: {
          agenda_id?: string
          calidad?: Database['public']['Enums']['calidad_sueno'] | null
          created_at?: string
          hora_fin?: string | null
          hora_inicio?: string
          id?: string
          observaciones?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'suenos_agenda_id_fkey'
            columns: ['agenda_id']
            isOneToOne: false
            referencedRelation: 'agendas_diarias'
            referencedColumns: ['id']
          },
        ]
      }
      usuarios: {
        Row: {
          consentimiento_privacidad_version: string | null
          consentimiento_terminos_version: string | null
          created_at: string
          deleted_at: string | null
          id: string
          idioma_preferido: string
          nombre_completo: string
          updated_at: string
        }
        Insert: {
          consentimiento_privacidad_version?: string | null
          consentimiento_terminos_version?: string | null
          created_at?: string
          deleted_at?: string | null
          id: string
          idioma_preferido?: string
          nombre_completo: string
          updated_at?: string
        }
        Update: {
          consentimiento_privacidad_version?: string | null
          consentimiento_terminos_version?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          idioma_preferido?: string
          nombre_completo?: string
          updated_at?: string
        }
        Relationships: []
      }
      vinculos_familiares: {
        Row: {
          created_at: string
          deleted_at: string | null
          descripcion_parentesco: string | null
          id: string
          nino_id: string
          parentesco: Database['public']['Enums']['parentesco']
          permisos: Json
          tipo_vinculo: Database['public']['Enums']['tipo_vinculo']
          updated_at: string
          usuario_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          descripcion_parentesco?: string | null
          id?: string
          nino_id: string
          parentesco: Database['public']['Enums']['parentesco']
          permisos?: Json
          tipo_vinculo: Database['public']['Enums']['tipo_vinculo']
          updated_at?: string
          usuario_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          descripcion_parentesco?: string | null
          id?: string
          nino_id?: string
          parentesco?: Database['public']['Enums']['parentesco']
          permisos?: Json
          tipo_vinculo?: Database['public']['Enums']['tipo_vinculo']
          updated_at?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'vinculos_familiares_nino_id_fkey'
            columns: ['nino_id']
            isOneToOne: false
            referencedRelation: 'ninos'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'vinculos_familiares_usuario_id_fkey'
            columns: ['usuario_id']
            isOneToOne: false
            referencedRelation: 'usuarios'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _get_medical_key: { Args: never; Returns: string }
      centro_de_agenda: { Args: { p_agenda_id: string }; Returns: string }
      centro_de_aula: { Args: { p_aula_id: string }; Returns: string }
      centro_de_nino: { Args: { p_nino_id: string }; Returns: string }
      dentro_de_ventana_edicion: { Args: { p_fecha: string }; Returns: boolean }
      es_admin: { Args: { p_centro_id?: string }; Returns: boolean }
      es_profe_de_aula: { Args: { p_aula_id: string }; Returns: boolean }
      es_profe_de_nino: { Args: { p_nino_id: string }; Returns: boolean }
      es_tutor_de: { Args: { p_nino_id: string }; Returns: boolean }
      fecha_de_agenda: { Args: { p_agenda_id: string }; Returns: string }
      get_info_medica_emergencia: {
        Args: { p_nino_id: string }
        Returns: {
          alergias_graves: string
          alergias_leves: string
          medicacion_habitual: string
          medico_familia: string
          notas_emergencia: string
          telefono_emergencia: string
        }[]
      }
      hoy_madrid: { Args: never; Returns: string }
      idiomas_iso_2letras: { Args: { p_codigos: string[] }; Returns: boolean }
      nino_de_agenda: { Args: { p_agenda_id: string }; Returns: string }
      pertenece_a_centro: { Args: { p_centro_id: string }; Returns: boolean }
      set_info_medica_emergencia_cifrada: {
        Args: {
          p_alergias_graves: string
          p_alergias_leves: string
          p_medicacion_habitual: string
          p_medico_familia: string
          p_nino_id: string
          p_notas_emergencia: string
          p_telefono_emergencia: string
        }
        Returns: string
      }
      tiene_permiso_sobre: {
        Args: { p_nino_id: string; p_permiso: string }
        Returns: boolean
      }
      usuario_actual: { Args: never; Returns: string }
    }
    Enums: {
      audit_accion: 'INSERT' | 'UPDATE' | 'DELETE'
      calidad_sueno: 'profundo' | 'tranquilo' | 'intermitente' | 'nada'
      cantidad_comida: 'todo' | 'mayoria' | 'mitad' | 'poco' | 'nada'
      cantidad_deposicion: 'mucha' | 'normal' | 'poca'
      consentimiento_tipo: 'terminos' | 'privacidad' | 'imagen' | 'datos_medicos'
      consistencia_deposicion: 'normal' | 'dura' | 'blanda' | 'diarrea'
      control_esfinteres: 'panal_completo' | 'transicion' | 'sin_panal_diurno' | 'sin_panal_total'
      curso_estado: 'planificado' | 'activo' | 'cerrado'
      estado_asistencia: 'presente' | 'ausente' | 'llegada_tarde' | 'salida_temprana'
      estado_general_agenda: 'bien' | 'regular' | 'mal' | 'mixto'
      humor_agenda: 'feliz' | 'tranquilo' | 'inquieto' | 'triste' | 'cansado'
      lactancia_estado: 'materna' | 'biberon' | 'mixta' | 'finalizada' | 'no_aplica'
      momento_comida: 'desayuno' | 'media_manana' | 'comida' | 'merienda'
      motivo_ausencia: 'enfermedad' | 'cita_medica' | 'vacaciones' | 'familiar' | 'otro'
      nino_sexo: 'F' | 'M' | 'X'
      parentesco:
        | 'madre'
        | 'padre'
        | 'abuela'
        | 'abuelo'
        | 'tia'
        | 'tio'
        | 'hermana'
        | 'hermano'
        | 'cuidadora'
        | 'otro'
      tipo_alimentacion:
        | 'omnivora'
        | 'vegetariana'
        | 'vegana'
        | 'sin_lactosa'
        | 'sin_gluten'
        | 'religiosa_halal'
        | 'religiosa_kosher'
        | 'otra'
      tipo_biberon: 'materna' | 'formula' | 'agua' | 'infusion' | 'zumo'
      tipo_deposicion: 'pipi' | 'caca' | 'mixto'
      tipo_vinculo: 'tutor_legal_principal' | 'tutor_legal_secundario' | 'autorizado'
      user_role: 'admin' | 'profe' | 'tutor_legal' | 'autorizado'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      audit_accion: ['INSERT', 'UPDATE', 'DELETE'],
      calidad_sueno: ['profundo', 'tranquilo', 'intermitente', 'nada'],
      cantidad_comida: ['todo', 'mayoria', 'mitad', 'poco', 'nada'],
      cantidad_deposicion: ['mucha', 'normal', 'poca'],
      consentimiento_tipo: ['terminos', 'privacidad', 'imagen', 'datos_medicos'],
      consistencia_deposicion: ['normal', 'dura', 'blanda', 'diarrea'],
      control_esfinteres: ['panal_completo', 'transicion', 'sin_panal_diurno', 'sin_panal_total'],
      curso_estado: ['planificado', 'activo', 'cerrado'],
      estado_asistencia: ['presente', 'ausente', 'llegada_tarde', 'salida_temprana'],
      estado_general_agenda: ['bien', 'regular', 'mal', 'mixto'],
      humor_agenda: ['feliz', 'tranquilo', 'inquieto', 'triste', 'cansado'],
      lactancia_estado: ['materna', 'biberon', 'mixta', 'finalizada', 'no_aplica'],
      momento_comida: ['desayuno', 'media_manana', 'comida', 'merienda'],
      motivo_ausencia: ['enfermedad', 'cita_medica', 'vacaciones', 'familiar', 'otro'],
      nino_sexo: ['F', 'M', 'X'],
      parentesco: [
        'madre',
        'padre',
        'abuela',
        'abuelo',
        'tia',
        'tio',
        'hermana',
        'hermano',
        'cuidadora',
        'otro',
      ],
      tipo_alimentacion: [
        'omnivora',
        'vegetariana',
        'vegana',
        'sin_lactosa',
        'sin_gluten',
        'religiosa_halal',
        'religiosa_kosher',
        'otra',
      ],
      tipo_biberon: ['materna', 'formula', 'agua', 'infusion', 'zumo'],
      tipo_deposicion: ['pipi', 'caca', 'mixto'],
      tipo_vinculo: ['tutor_legal_principal', 'tutor_legal_secundario', 'autorizado'],
      user_role: ['admin', 'profe', 'tutor_legal', 'autorizado'],
    },
  },
} as const
