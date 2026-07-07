export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      administraciones_medicacion: {
        Row: {
          administrado_en: string
          administrado_por: string
          autorizacion_id: string
          centro_id: string
          confirmado_at: string | null
          confirmado_por: string | null
          created_at: string
          dosis: string
          id: string
          medicamento: string
          nino_id: string
          notas: string | null
        }
        Insert: {
          administrado_en?: string
          administrado_por: string
          autorizacion_id: string
          centro_id: string
          confirmado_at?: string | null
          confirmado_por?: string | null
          created_at?: string
          dosis: string
          id?: string
          medicamento: string
          nino_id: string
          notas?: string | null
        }
        Update: {
          administrado_en?: string
          administrado_por?: string
          autorizacion_id?: string
          centro_id?: string
          confirmado_at?: string | null
          confirmado_por?: string | null
          created_at?: string
          dosis?: string
          id?: string
          medicamento?: string
          nino_id?: string
          notas?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "administraciones_medicacion_administrado_por_fkey"
            columns: ["administrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "administraciones_medicacion_autorizacion_id_fkey"
            columns: ["autorizacion_id"]
            isOneToOne: false
            referencedRelation: "autorizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "administraciones_medicacion_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "administraciones_medicacion_confirmado_por_fkey"
            columns: ["confirmado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "administraciones_medicacion_nino_id_fkey"
            columns: ["nino_id"]
            isOneToOne: false
            referencedRelation: "ninos"
            referencedColumns: ["id"]
          },
        ]
      }
      agendas_diarias: {
        Row: {
          created_at: string
          estado_general:
            | Database["public"]["Enums"]["estado_general_agenda"]
            | null
          fecha: string
          humor: Database["public"]["Enums"]["humor_agenda"] | null
          id: string
          nino_id: string
          observaciones_generales: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          estado_general?:
            | Database["public"]["Enums"]["estado_general_agenda"]
            | null
          fecha: string
          humor?: Database["public"]["Enums"]["humor_agenda"] | null
          id?: string
          nino_id: string
          observaciones_generales?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          estado_general?:
            | Database["public"]["Enums"]["estado_general_agenda"]
            | null
          fecha?: string
          humor?: Database["public"]["Enums"]["humor_agenda"] | null
          id?: string
          nino_id?: string
          observaciones_generales?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agendas_diarias_nino_id_fkey"
            columns: ["nino_id"]
            isOneToOne: false
            referencedRelation: "ninos"
            referencedColumns: ["id"]
          },
        ]
      }
      anuncios: {
        Row: {
          ambito: Database["public"]["Enums"]["ambito_anuncio"]
          aula_id: string | null
          autor_id: string
          centro_id: string
          contenido: string
          created_at: string
          erroneo: boolean
          id: string
          titulo: string
          updated_at: string
        }
        Insert: {
          ambito: Database["public"]["Enums"]["ambito_anuncio"]
          aula_id?: string | null
          autor_id: string
          centro_id: string
          contenido: string
          created_at?: string
          erroneo?: boolean
          id?: string
          titulo: string
          updated_at?: string
        }
        Update: {
          ambito?: Database["public"]["Enums"]["ambito_anuncio"]
          aula_id?: string | null
          autor_id?: string
          centro_id?: string
          contenido?: string
          created_at?: string
          erroneo?: boolean
          id?: string
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "anuncios_aula_id_fkey"
            columns: ["aula_id"]
            isOneToOne: false
            referencedRelation: "aulas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anuncios_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anuncios_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
        ]
      }
      asignacion_cuota: {
        Row: {
          anio: number
          centro_id: string
          concepto_id: string
          created_at: string
          deleted_at: string | null
          id: string
          mes: number
          modalidad: Database["public"]["Enums"]["modalidad_cobro"]
          nino_id: string
          updated_at: string
        }
        Insert: {
          anio: number
          centro_id: string
          concepto_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          mes: number
          modalidad: Database["public"]["Enums"]["modalidad_cobro"]
          nino_id: string
          updated_at?: string
        }
        Update: {
          anio?: number
          centro_id?: string
          concepto_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          mes?: number
          modalidad?: Database["public"]["Enums"]["modalidad_cobro"]
          nino_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "asignacion_cuota_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asignacion_cuota_concepto_id_fkey"
            columns: ["concepto_id"]
            isOneToOne: false
            referencedRelation: "conceptos_cobro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asignacion_cuota_nino_id_fkey"
            columns: ["nino_id"]
            isOneToOne: false
            referencedRelation: "ninos"
            referencedColumns: ["id"]
          },
        ]
      }
      asistencias: {
        Row: {
          created_at: string
          estado: Database["public"]["Enums"]["estado_asistencia"]
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
          estado: Database["public"]["Enums"]["estado_asistencia"]
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
          estado?: Database["public"]["Enums"]["estado_asistencia"]
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
            foreignKeyName: "asistencias_nino_id_fkey"
            columns: ["nino_id"]
            isOneToOne: false
            referencedRelation: "ninos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asistencias_registrada_por_fkey"
            columns: ["registrada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          accion: Database["public"]["Enums"]["audit_accion"]
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
          accion: Database["public"]["Enums"]["audit_accion"]
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
          accion?: Database["public"]["Enums"]["audit_accion"]
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
            foreignKeyName: "audit_log_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      aulas: {
        Row: {
          centro_id: string
          created_at: string
          deleted_at: string | null
          descripcion: string | null
          id: string
          nombre: string
          updated_at: string
        }
        Insert: {
          centro_id: string
          created_at?: string
          deleted_at?: string | null
          descripcion?: string | null
          id?: string
          nombre: string
          updated_at?: string
        }
        Update: {
          centro_id?: string
          created_at?: string
          deleted_at?: string | null
          descripcion?: string | null
          id?: string
          nombre?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "aulas_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
        ]
      }
      aulas_curso: {
        Row: {
          aula_id: string
          capacidad: number
          centro_id: string
          created_at: string
          curso_academico_id: string
          id: string
          tramo_edad: number[]
          updated_at: string
        }
        Insert: {
          aula_id: string
          capacidad?: number
          centro_id: string
          created_at?: string
          curso_academico_id: string
          id?: string
          tramo_edad: number[]
          updated_at?: string
        }
        Update: {
          aula_id?: string
          capacidad?: number
          centro_id?: string
          created_at?: string
          curso_academico_id?: string
          id?: string
          tramo_edad?: number[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "aulas_curso_aula_id_fkey"
            columns: ["aula_id"]
            isOneToOne: false
            referencedRelation: "aulas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aulas_curso_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aulas_curso_curso_academico_id_fkey"
            columns: ["curso_academico_id"]
            isOneToOne: false
            referencedRelation: "cursos_academicos"
            referencedColumns: ["id"]
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
          motivo: Database["public"]["Enums"]["motivo_ausencia"]
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
          motivo: Database["public"]["Enums"]["motivo_ausencia"]
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
          motivo?: Database["public"]["Enums"]["motivo_ausencia"]
          nino_id?: string
          reportada_por?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ausencias_nino_id_fkey"
            columns: ["nino_id"]
            isOneToOne: false
            referencedRelation: "ninos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ausencias_reportada_por_fkey"
            columns: ["reportada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
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
      autorizaciones: {
        Row: {
          ambito: Database["public"]["Enums"]["autorizacion_ambito"] | null
          archivada_at: string | null
          archivada_por: string | null
          aula_id: string | null
          centro_id: string
          creado_por: string
          created_at: string
          datos: Json
          es_plantilla: boolean
          estado: Database["public"]["Enums"]["autorizacion_estado"]
          evento_id: string | null
          firmantes_requeridos: Database["public"]["Enums"]["politica_firmantes"]
          id: string
          nino_id: string | null
          plantilla_id: string | null
          texto: string
          texto_definitivo: boolean
          texto_version: string
          tipo: Database["public"]["Enums"]["tipo_autorizacion"]
          titulo: string
          updated_at: string
          vigencia_desde: string | null
          vigencia_hasta: string | null
        }
        Insert: {
          ambito?: Database["public"]["Enums"]["autorizacion_ambito"] | null
          archivada_at?: string | null
          archivada_por?: string | null
          aula_id?: string | null
          centro_id: string
          creado_por: string
          created_at?: string
          datos?: Json
          es_plantilla?: boolean
          estado?: Database["public"]["Enums"]["autorizacion_estado"]
          evento_id?: string | null
          firmantes_requeridos?: Database["public"]["Enums"]["politica_firmantes"]
          id?: string
          nino_id?: string | null
          plantilla_id?: string | null
          texto: string
          texto_definitivo?: boolean
          texto_version?: string
          tipo: Database["public"]["Enums"]["tipo_autorizacion"]
          titulo: string
          updated_at?: string
          vigencia_desde?: string | null
          vigencia_hasta?: string | null
        }
        Update: {
          ambito?: Database["public"]["Enums"]["autorizacion_ambito"] | null
          archivada_at?: string | null
          archivada_por?: string | null
          aula_id?: string | null
          centro_id?: string
          creado_por?: string
          created_at?: string
          datos?: Json
          es_plantilla?: boolean
          estado?: Database["public"]["Enums"]["autorizacion_estado"]
          evento_id?: string | null
          firmantes_requeridos?: Database["public"]["Enums"]["politica_firmantes"]
          id?: string
          nino_id?: string | null
          plantilla_id?: string | null
          texto?: string
          texto_definitivo?: boolean
          texto_version?: string
          tipo?: Database["public"]["Enums"]["tipo_autorizacion"]
          titulo?: string
          updated_at?: string
          vigencia_desde?: string | null
          vigencia_hasta?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "autorizaciones_archivada_por_fkey"
            columns: ["archivada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autorizaciones_aula_id_fkey"
            columns: ["aula_id"]
            isOneToOne: false
            referencedRelation: "aulas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autorizaciones_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autorizaciones_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autorizaciones_evento_id_fkey"
            columns: ["evento_id"]
            isOneToOne: false
            referencedRelation: "eventos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autorizaciones_nino_id_fkey"
            columns: ["nino_id"]
            isOneToOne: false
            referencedRelation: "ninos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autorizaciones_plantilla_id_fkey"
            columns: ["plantilla_id"]
            isOneToOne: false
            referencedRelation: "autorizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      becas: {
        Row: {
          centro_id: string
          created_at: string
          deleted_at: string | null
          fecha_desde: string
          fecha_hasta: string | null
          id: string
          importe_centimos: number
          nino_id: string
          tipo_beca_id: string
          updated_at: string
        }
        Insert: {
          centro_id: string
          created_at?: string
          deleted_at?: string | null
          fecha_desde: string
          fecha_hasta?: string | null
          id?: string
          importe_centimos: number
          nino_id: string
          tipo_beca_id: string
          updated_at?: string
        }
        Update: {
          centro_id?: string
          created_at?: string
          deleted_at?: string | null
          fecha_desde?: string
          fecha_hasta?: string | null
          id?: string
          importe_centimos?: number
          nino_id?: string
          tipo_beca_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "becas_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "becas_nino_id_fkey"
            columns: ["nino_id"]
            isOneToOne: false
            referencedRelation: "ninos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "becas_tipo_beca_id_fkey"
            columns: ["tipo_beca_id"]
            isOneToOne: false
            referencedRelation: "tipos_beca"
            referencedColumns: ["id"]
          },
        ]
      }
      biberones: {
        Row: {
          agenda_id: string
          cantidad_ml: number
          created_at: string
          hora: string
          id: string
          observaciones: string | null
          tipo: Database["public"]["Enums"]["tipo_biberon"]
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
          tipo: Database["public"]["Enums"]["tipo_biberon"]
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
          tipo?: Database["public"]["Enums"]["tipo_biberon"]
          tomado_completo?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "biberones_agenda_id_fkey"
            columns: ["agenda_id"]
            isOneToOne: false
            referencedRelation: "agendas_diarias"
            referencedColumns: ["id"]
          },
        ]
      }
      cambios_pendientes: {
        Row: {
          campo: string | null
          centro_id: string
          created_at: string
          decided_at: string | null
          entidad: string
          estado: Database["public"]["Enums"]["estado_cambio_pendiente"]
          id: string
          nino_id: string
          payload: Json | null
          registro_id: string
          revisado_por: string | null
          solicitado_por: string
          valor_propuesto: Json | null
        }
        Insert: {
          campo?: string | null
          centro_id: string
          created_at?: string
          decided_at?: string | null
          entidad: string
          estado?: Database["public"]["Enums"]["estado_cambio_pendiente"]
          id?: string
          nino_id: string
          payload?: Json | null
          registro_id: string
          revisado_por?: string | null
          solicitado_por: string
          valor_propuesto?: Json | null
        }
        Update: {
          campo?: string | null
          centro_id?: string
          created_at?: string
          decided_at?: string | null
          entidad?: string
          estado?: Database["public"]["Enums"]["estado_cambio_pendiente"]
          id?: string
          nino_id?: string
          payload?: Json | null
          registro_id?: string
          revisado_por?: string | null
          solicitado_por?: string
          valor_propuesto?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "cambios_pendientes_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cambios_pendientes_nino_id_fkey"
            columns: ["nino_id"]
            isOneToOne: false
            referencedRelation: "ninos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cambios_pendientes_revisado_por_fkey"
            columns: ["revisado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cambios_pendientes_solicitado_por_fkey"
            columns: ["solicitado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      campanas_informe: {
        Row: {
          centro_id: string
          created_at: string
          created_by: string
          curso_academico_id: string
          estado: Database["public"]["Enums"]["estado_campana_informe"]
          fecha_limite: string
          id: string
          periodo: Database["public"]["Enums"]["periodo_informe"]
          updated_at: string
        }
        Insert: {
          centro_id: string
          created_at?: string
          created_by: string
          curso_academico_id: string
          estado?: Database["public"]["Enums"]["estado_campana_informe"]
          fecha_limite: string
          id?: string
          periodo: Database["public"]["Enums"]["periodo_informe"]
          updated_at?: string
        }
        Update: {
          centro_id?: string
          created_at?: string
          created_by?: string
          curso_academico_id?: string
          estado?: Database["public"]["Enums"]["estado_campana_informe"]
          fecha_limite?: string
          id?: string
          periodo?: Database["public"]["Enums"]["periodo_informe"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campanas_informe_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanas_informe_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanas_informe_curso_academico_id_fkey"
            columns: ["curso_academico_id"]
            isOneToOne: false
            referencedRelation: "cursos_academicos"
            referencedColumns: ["id"]
          },
        ]
      }
      centros: {
        Row: {
          bic_acreedor: string | null
          created_at: string
          deleted_at: string | null
          direccion: string
          email_contacto: string
          iban_acreedor_cifrado: string | null
          id: string
          identificador_acreedor: string | null
          idioma_default: string
          logo_url: string | null
          nombre: string
          telefono: string
          updated_at: string
          web: string | null
        }
        Insert: {
          bic_acreedor?: string | null
          created_at?: string
          deleted_at?: string | null
          direccion: string
          email_contacto: string
          iban_acreedor_cifrado?: string | null
          id?: string
          identificador_acreedor?: string | null
          idioma_default?: string
          logo_url?: string | null
          nombre: string
          telefono: string
          updated_at?: string
          web?: string | null
        }
        Update: {
          bic_acreedor?: string | null
          created_at?: string
          deleted_at?: string | null
          direccion?: string
          email_contacto?: string
          iban_acreedor_cifrado?: string | null
          id?: string
          identificador_acreedor?: string | null
          idioma_default?: string
          logo_url?: string | null
          nombre?: string
          telefono?: string
          updated_at?: string
          web?: string | null
        }
        Relationships: []
      }
      cierre_mensual: {
        Row: {
          anio: number
          centro_id: string
          cerrado_at: string
          cerrado_por: string
          created_at: string
          id: string
          mes: number
        }
        Insert: {
          anio: number
          centro_id: string
          cerrado_at?: string
          cerrado_por: string
          created_at?: string
          id?: string
          mes: number
        }
        Update: {
          anio?: number
          centro_id?: string
          cerrado_at?: string
          cerrado_por?: string
          created_at?: string
          id?: string
          mes?: number
        }
        Relationships: [
          {
            foreignKeyName: "cierre_mensual_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cierre_mensual_cerrado_por_fkey"
            columns: ["cerrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      cita_invitados: {
        Row: {
          centro_id: string
          cita_id: string
          comentario: string | null
          created_at: string
          estado: Database["public"]["Enums"]["rsvp_estado"]
          id: string
          nombre_externo: string | null
          respondido_at: string | null
          respondido_por: string | null
          updated_at: string
          usuario_id: string | null
        }
        Insert: {
          centro_id: string
          cita_id: string
          comentario?: string | null
          created_at?: string
          estado?: Database["public"]["Enums"]["rsvp_estado"]
          id?: string
          nombre_externo?: string | null
          respondido_at?: string | null
          respondido_por?: string | null
          updated_at?: string
          usuario_id?: string | null
        }
        Update: {
          centro_id?: string
          cita_id?: string
          comentario?: string | null
          created_at?: string
          estado?: Database["public"]["Enums"]["rsvp_estado"]
          id?: string
          nombre_externo?: string | null
          respondido_at?: string | null
          respondido_por?: string | null
          updated_at?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cita_invitados_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cita_invitados_cita_id_fkey"
            columns: ["cita_id"]
            isOneToOne: false
            referencedRelation: "citas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cita_invitados_respondido_por_fkey"
            columns: ["respondido_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cita_invitados_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      citas: {
        Row: {
          aula_id: string | null
          centro_id: string
          created_at: string
          descripcion: string | null
          estado: Database["public"]["Enums"]["cita_estado"]
          fecha: string
          hora_fin: string | null
          hora_inicio: string
          id: string
          lugar: string | null
          nino_id: string | null
          organizador_id: string
          tipo: Database["public"]["Enums"]["tipo_cita"]
          titulo: string
          updated_at: string
        }
        Insert: {
          aula_id?: string | null
          centro_id: string
          created_at?: string
          descripcion?: string | null
          estado?: Database["public"]["Enums"]["cita_estado"]
          fecha: string
          hora_fin?: string | null
          hora_inicio: string
          id?: string
          lugar?: string | null
          nino_id?: string | null
          organizador_id: string
          tipo: Database["public"]["Enums"]["tipo_cita"]
          titulo: string
          updated_at?: string
        }
        Update: {
          aula_id?: string | null
          centro_id?: string
          created_at?: string
          descripcion?: string | null
          estado?: Database["public"]["Enums"]["cita_estado"]
          fecha?: string
          hora_fin?: string | null
          hora_inicio?: string
          id?: string
          lugar?: string | null
          nino_id?: string | null
          organizador_id?: string
          tipo?: Database["public"]["Enums"]["tipo_cita"]
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "citas_aula_id_fkey"
            columns: ["aula_id"]
            isOneToOne: false
            referencedRelation: "aulas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "citas_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "citas_nino_id_fkey"
            columns: ["nino_id"]
            isOneToOne: false
            referencedRelation: "ninos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "citas_organizador_id_fkey"
            columns: ["organizador_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      comidas: {
        Row: {
          agenda_id: string
          cantidad: Database["public"]["Enums"]["cantidad_comida"]
          created_at: string
          descripcion: string | null
          hora: string | null
          id: string
          menu_dia_id: string | null
          momento: Database["public"]["Enums"]["momento_comida"]
          observaciones: string | null
          tipo_plato: Database["public"]["Enums"]["tipo_plato_comida"] | null
          updated_at: string
        }
        Insert: {
          agenda_id: string
          cantidad: Database["public"]["Enums"]["cantidad_comida"]
          created_at?: string
          descripcion?: string | null
          hora?: string | null
          id?: string
          menu_dia_id?: string | null
          momento: Database["public"]["Enums"]["momento_comida"]
          observaciones?: string | null
          tipo_plato?: Database["public"]["Enums"]["tipo_plato_comida"] | null
          updated_at?: string
        }
        Update: {
          agenda_id?: string
          cantidad?: Database["public"]["Enums"]["cantidad_comida"]
          created_at?: string
          descripcion?: string | null
          hora?: string | null
          id?: string
          menu_dia_id?: string | null
          momento?: Database["public"]["Enums"]["momento_comida"]
          observaciones?: string | null
          tipo_plato?: Database["public"]["Enums"]["tipo_plato_comida"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "comidas_agenda_id_fkey"
            columns: ["agenda_id"]
            isOneToOne: false
            referencedRelation: "agendas_diarias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comidas_menu_dia_id_fkey"
            columns: ["menu_dia_id"]
            isOneToOne: false
            referencedRelation: "menu_dia"
            referencedColumns: ["id"]
          },
        ]
      }
      conceptos_cobro: {
        Row: {
          activo: boolean
          centro_id: string
          created_at: string
          deleted_at: string | null
          id: string
          nombre: string
          precio_diario_centimos: number | null
          precio_mensual_centimos: number | null
          servicio: Database["public"]["Enums"]["servicio_diario"] | null
          tipo_concepto: Database["public"]["Enums"]["tipo_concepto"]
          updated_at: string
        }
        Insert: {
          activo?: boolean
          centro_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          nombre: string
          precio_diario_centimos?: number | null
          precio_mensual_centimos?: number | null
          servicio?: Database["public"]["Enums"]["servicio_diario"] | null
          tipo_concepto: Database["public"]["Enums"]["tipo_concepto"]
          updated_at?: string
        }
        Update: {
          activo?: boolean
          centro_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          nombre?: string
          precio_diario_centimos?: number | null
          precio_mensual_centimos?: number | null
          servicio?: Database["public"]["Enums"]["servicio_diario"] | null
          tipo_concepto?: Database["public"]["Enums"]["tipo_concepto"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conceptos_cobro_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
        ]
      }
      confirmaciones_evento: {
        Row: {
          comentario: string | null
          confirmado_at: string
          confirmado_por: string
          created_at: string
          estado: Database["public"]["Enums"]["confirmacion_estado"]
          evento_id: string
          id: string
          nino_id: string
          updated_at: string
        }
        Insert: {
          comentario?: string | null
          confirmado_at?: string
          confirmado_por: string
          created_at?: string
          estado: Database["public"]["Enums"]["confirmacion_estado"]
          evento_id: string
          id?: string
          nino_id: string
          updated_at?: string
        }
        Update: {
          comentario?: string | null
          confirmado_at?: string
          confirmado_por?: string
          created_at?: string
          estado?: Database["public"]["Enums"]["confirmacion_estado"]
          evento_id?: string
          id?: string
          nino_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "confirmaciones_evento_confirmado_por_fkey"
            columns: ["confirmado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confirmaciones_evento_evento_id_fkey"
            columns: ["evento_id"]
            isOneToOne: false
            referencedRelation: "eventos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confirmaciones_evento_nino_id_fkey"
            columns: ["nino_id"]
            isOneToOne: false
            referencedRelation: "ninos"
            referencedColumns: ["id"]
          },
        ]
      }
      consentimientos: {
        Row: {
          aceptado_en: string
          created_at: string
          id: string
          ip_address: unknown
          metodo_firma: Database["public"]["Enums"]["firma_metodo"]
          revocado_en: string | null
          tipo: Database["public"]["Enums"]["consentimiento_tipo"]
          user_agent: string | null
          usuario_id: string
          version: string
        }
        Insert: {
          aceptado_en?: string
          created_at?: string
          id?: string
          ip_address?: unknown
          metodo_firma?: Database["public"]["Enums"]["firma_metodo"]
          revocado_en?: string | null
          tipo: Database["public"]["Enums"]["consentimiento_tipo"]
          user_agent?: string | null
          usuario_id: string
          version: string
        }
        Update: {
          aceptado_en?: string
          created_at?: string
          id?: string
          ip_address?: unknown
          metodo_firma?: Database["public"]["Enums"]["firma_metodo"]
          revocado_en?: string | null
          tipo?: Database["public"]["Enums"]["consentimiento_tipo"]
          user_agent?: string | null
          usuario_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "consentimientos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      conversaciones: {
        Row: {
          admin_id: string | null
          centro_id: string
          created_at: string
          expires_at: string | null
          id: string
          last_message_at: string | null
          nino_id: string | null
          tipo_conversacion: Database["public"]["Enums"]["tipo_conversacion"]
          tutor_id: string | null
          updated_at: string
        }
        Insert: {
          admin_id?: string | null
          centro_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          last_message_at?: string | null
          nino_id?: string | null
          tipo_conversacion?: Database["public"]["Enums"]["tipo_conversacion"]
          tutor_id?: string | null
          updated_at?: string
        }
        Update: {
          admin_id?: string | null
          centro_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          last_message_at?: string | null
          nino_id?: string | null
          tipo_conversacion?: Database["public"]["Enums"]["tipo_conversacion"]
          tutor_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversaciones_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversaciones_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversaciones_nino_id_fkey"
            columns: ["nino_id"]
            isOneToOne: true
            referencedRelation: "ninos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversaciones_tutor_id_fkey"
            columns: ["tutor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      cursos_academicos: {
        Row: {
          centro_id: string
          created_at: string
          deleted_at: string | null
          estado: Database["public"]["Enums"]["curso_estado"]
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
          estado?: Database["public"]["Enums"]["curso_estado"]
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
          estado?: Database["public"]["Enums"]["curso_estado"]
          fecha_fin?: string
          fecha_inicio?: string
          id?: string
          nombre?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cursos_academicos_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
        ]
      }
      datos_pedagogicos_nino: {
        Row: {
          alimentacion_observaciones: string | null
          control_esfinteres: Database["public"]["Enums"]["control_esfinteres"]
          control_esfinteres_observaciones: string | null
          created_at: string
          deleted_at: string | null
          id: string
          idiomas_casa: string[]
          lactancia_estado: Database["public"]["Enums"]["lactancia_estado"]
          lactancia_observaciones: string | null
          nino_id: string
          siesta_horario_habitual: string | null
          siesta_numero_diario: number | null
          siesta_observaciones: string | null
          tiene_hermanos_en_centro: boolean
          tipo_alimentacion: Database["public"]["Enums"]["tipo_alimentacion"]
          updated_at: string
        }
        Insert: {
          alimentacion_observaciones?: string | null
          control_esfinteres: Database["public"]["Enums"]["control_esfinteres"]
          control_esfinteres_observaciones?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          idiomas_casa: string[]
          lactancia_estado: Database["public"]["Enums"]["lactancia_estado"]
          lactancia_observaciones?: string | null
          nino_id: string
          siesta_horario_habitual?: string | null
          siesta_numero_diario?: number | null
          siesta_observaciones?: string | null
          tiene_hermanos_en_centro?: boolean
          tipo_alimentacion: Database["public"]["Enums"]["tipo_alimentacion"]
          updated_at?: string
        }
        Update: {
          alimentacion_observaciones?: string | null
          control_esfinteres?: Database["public"]["Enums"]["control_esfinteres"]
          control_esfinteres_observaciones?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          idiomas_casa?: string[]
          lactancia_estado?: Database["public"]["Enums"]["lactancia_estado"]
          lactancia_observaciones?: string | null
          nino_id?: string
          siesta_horario_habitual?: string | null
          siesta_numero_diario?: number | null
          siesta_observaciones?: string | null
          tiene_hermanos_en_centro?: boolean
          tipo_alimentacion?: Database["public"]["Enums"]["tipo_alimentacion"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "datos_pedagogicos_nino_nino_id_fkey"
            columns: ["nino_id"]
            isOneToOne: true
            referencedRelation: "ninos"
            referencedColumns: ["id"]
          },
        ]
      }
      datos_tutor: {
        Row: {
          centro_id: string
          created_at: string
          deleted_at: string | null
          direccion_calle: string | null
          direccion_ciudad: string | null
          direccion_cp: string | null
          direccion_numero: string | null
          dni_documento_path: string | null
          email: string | null
          id: string
          nino_id: string
          nombre_completo: string | null
          tipo_vinculo: Database["public"]["Enums"]["tipo_vinculo"]
          updated_at: string
          usuario_id: string | null
        }
        Insert: {
          centro_id: string
          created_at?: string
          deleted_at?: string | null
          direccion_calle?: string | null
          direccion_ciudad?: string | null
          direccion_cp?: string | null
          direccion_numero?: string | null
          dni_documento_path?: string | null
          email?: string | null
          id?: string
          nino_id: string
          nombre_completo?: string | null
          tipo_vinculo: Database["public"]["Enums"]["tipo_vinculo"]
          updated_at?: string
          usuario_id?: string | null
        }
        Update: {
          centro_id?: string
          created_at?: string
          deleted_at?: string | null
          direccion_calle?: string | null
          direccion_ciudad?: string | null
          direccion_cp?: string | null
          direccion_numero?: string | null
          dni_documento_path?: string | null
          email?: string | null
          id?: string
          nino_id?: string
          nombre_completo?: string | null
          tipo_vinculo?: Database["public"]["Enums"]["tipo_vinculo"]
          updated_at?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "datos_tutor_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "datos_tutor_nino_id_fkey"
            columns: ["nino_id"]
            isOneToOne: false
            referencedRelation: "ninos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "datos_tutor_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      deposiciones: {
        Row: {
          agenda_id: string
          cantidad: Database["public"]["Enums"]["cantidad_deposicion"]
          consistencia:
            | Database["public"]["Enums"]["consistencia_deposicion"]
            | null
          created_at: string
          hora: string | null
          id: string
          observaciones: string | null
          tipo: Database["public"]["Enums"]["tipo_deposicion"]
          updated_at: string
        }
        Insert: {
          agenda_id: string
          cantidad: Database["public"]["Enums"]["cantidad_deposicion"]
          consistencia?:
            | Database["public"]["Enums"]["consistencia_deposicion"]
            | null
          created_at?: string
          hora?: string | null
          id?: string
          observaciones?: string | null
          tipo: Database["public"]["Enums"]["tipo_deposicion"]
          updated_at?: string
        }
        Update: {
          agenda_id?: string
          cantidad?: Database["public"]["Enums"]["cantidad_deposicion"]
          consistencia?:
            | Database["public"]["Enums"]["consistencia_deposicion"]
            | null
          created_at?: string
          hora?: string | null
          id?: string
          observaciones?: string | null
          tipo?: Database["public"]["Enums"]["tipo_deposicion"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deposiciones_agenda_id_fkey"
            columns: ["agenda_id"]
            isOneToOne: false
            referencedRelation: "agendas_diarias"
            referencedColumns: ["id"]
          },
        ]
      }
      dias_centro: {
        Row: {
          centro_id: string
          creado_por: string | null
          created_at: string
          fecha: string
          id: string
          observaciones: string | null
          tipo: Database["public"]["Enums"]["tipo_dia_centro"]
          updated_at: string
        }
        Insert: {
          centro_id: string
          creado_por?: string | null
          created_at?: string
          fecha: string
          id?: string
          observaciones?: string | null
          tipo: Database["public"]["Enums"]["tipo_dia_centro"]
          updated_at?: string
        }
        Update: {
          centro_id?: string
          creado_por?: string | null
          created_at?: string
          fecha?: string
          id?: string
          observaciones?: string | null
          tipo?: Database["public"]["Enums"]["tipo_dia_centro"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dias_centro_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dias_centro_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      eventos: {
        Row: {
          ambito: Database["public"]["Enums"]["ambito_evento"]
          aula_id: string | null
          centro_id: string
          creado_por: string
          created_at: string
          descripcion: string | null
          estado: Database["public"]["Enums"]["evento_estado"]
          fecha: string
          fecha_fin: string | null
          hora_fin: string | null
          hora_inicio: string | null
          id: string
          lugar: string | null
          nino_id: string | null
          requiere_confirmacion: boolean
          tipo: Database["public"]["Enums"]["tipo_evento"]
          titulo: string
          updated_at: string
        }
        Insert: {
          ambito: Database["public"]["Enums"]["ambito_evento"]
          aula_id?: string | null
          centro_id: string
          creado_por: string
          created_at?: string
          descripcion?: string | null
          estado?: Database["public"]["Enums"]["evento_estado"]
          fecha: string
          fecha_fin?: string | null
          hora_fin?: string | null
          hora_inicio?: string | null
          id?: string
          lugar?: string | null
          nino_id?: string | null
          requiere_confirmacion?: boolean
          tipo: Database["public"]["Enums"]["tipo_evento"]
          titulo: string
          updated_at?: string
        }
        Update: {
          ambito?: Database["public"]["Enums"]["ambito_evento"]
          aula_id?: string | null
          centro_id?: string
          creado_por?: string
          created_at?: string
          descripcion?: string | null
          estado?: Database["public"]["Enums"]["evento_estado"]
          fecha?: string
          fecha_fin?: string | null
          hora_fin?: string | null
          hora_inicio?: string | null
          id?: string
          lugar?: string | null
          nino_id?: string | null
          requiere_confirmacion?: boolean
          tipo?: Database["public"]["Enums"]["tipo_evento"]
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "eventos_aula_id_fkey"
            columns: ["aula_id"]
            isOneToOne: false
            referencedRelation: "aulas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_nino_id_fkey"
            columns: ["nino_id"]
            isOneToOne: false
            referencedRelation: "ninos"
            referencedColumns: ["id"]
          },
        ]
      }
      export_log: {
        Row: {
          centro_id: string
          created_at: string
          id: string
          solicitado_por: string | null
          sujeto_id: string
          sujeto_tipo: string
        }
        Insert: {
          centro_id: string
          created_at?: string
          id?: string
          solicitado_por?: string | null
          sujeto_id: string
          sujeto_tipo: string
        }
        Update: {
          centro_id?: string
          created_at?: string
          id?: string
          solicitado_por?: string | null
          sujeto_id?: string
          sujeto_tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "export_log_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "export_log_solicitado_por_fkey"
            columns: ["solicitado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      familia_tutores: {
        Row: {
          created_at: string
          deleted_at: string | null
          direccion_calle: string | null
          direccion_ciudad: string | null
          direccion_cp: string | null
          direccion_numero: string | null
          dni_documento_path: string | null
          email: string | null
          familia_id: string
          id: string
          nombre_completo: string | null
          rol_familia: string
          updated_at: string
          usuario_id: string | null
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          direccion_calle?: string | null
          direccion_ciudad?: string | null
          direccion_cp?: string | null
          direccion_numero?: string | null
          dni_documento_path?: string | null
          email?: string | null
          familia_id: string
          id?: string
          nombre_completo?: string | null
          rol_familia: string
          updated_at?: string
          usuario_id?: string | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          direccion_calle?: string | null
          direccion_ciudad?: string | null
          direccion_cp?: string | null
          direccion_numero?: string | null
          dni_documento_path?: string | null
          email?: string | null
          familia_id?: string
          id?: string
          nombre_completo?: string | null
          rol_familia?: string
          updated_at?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "familia_tutores_familia_id_fkey"
            columns: ["familia_id"]
            isOneToOne: false
            referencedRelation: "familias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "familia_tutores_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      familias: {
        Row: {
          centro_id: string
          created_at: string
          deleted_at: string | null
          etiqueta: string
          id: string
          updated_at: string
        }
        Insert: {
          centro_id: string
          created_at?: string
          deleted_at?: string | null
          etiqueta: string
          id?: string
          updated_at?: string
        }
        Update: {
          centro_id?: string
          created_at?: string
          deleted_at?: string | null
          etiqueta?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "familias_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
        ]
      }
      firmas_autorizacion: {
        Row: {
          autorizacion_id: string
          comentario: string | null
          created_at: string
          datos: Json
          decision: Database["public"]["Enums"]["firma_decision"]
          firma_imagen: string | null
          firmado_at: string
          firmante_id: string
          id: string
          ip_address: unknown
          metodo_firma: Database["public"]["Enums"]["firma_metodo"]
          nino_id: string
          nombre_tecleado: string
          rol_firmante: Database["public"]["Enums"]["tipo_vinculo"]
          texto_hash: string
          texto_version: string
          user_agent: string | null
        }
        Insert: {
          autorizacion_id: string
          comentario?: string | null
          created_at?: string
          datos?: Json
          decision: Database["public"]["Enums"]["firma_decision"]
          firma_imagen?: string | null
          firmado_at?: string
          firmante_id: string
          id?: string
          ip_address?: unknown
          metodo_firma?: Database["public"]["Enums"]["firma_metodo"]
          nino_id: string
          nombre_tecleado: string
          rol_firmante: Database["public"]["Enums"]["tipo_vinculo"]
          texto_hash: string
          texto_version: string
          user_agent?: string | null
        }
        Update: {
          autorizacion_id?: string
          comentario?: string | null
          created_at?: string
          datos?: Json
          decision?: Database["public"]["Enums"]["firma_decision"]
          firma_imagen?: string | null
          firmado_at?: string
          firmante_id?: string
          id?: string
          ip_address?: unknown
          metodo_firma?: Database["public"]["Enums"]["firma_metodo"]
          nino_id?: string
          nombre_tecleado?: string
          rol_firmante?: Database["public"]["Enums"]["tipo_vinculo"]
          texto_hash?: string
          texto_version?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "firmas_autorizacion_autorizacion_id_fkey"
            columns: ["autorizacion_id"]
            isOneToOne: false
            referencedRelation: "autorizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "firmas_autorizacion_firmante_id_fkey"
            columns: ["firmante_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "firmas_autorizacion_nino_id_fkey"
            columns: ["nino_id"]
            isOneToOne: false
            referencedRelation: "ninos"
            referencedColumns: ["id"]
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
            foreignKeyName: "info_medica_emergencia_nino_id_fkey"
            columns: ["nino_id"]
            isOneToOne: true
            referencedRelation: "ninos"
            referencedColumns: ["id"]
          },
        ]
      }
      informes_evolucion: {
        Row: {
          centro_id: string
          creado_por: string
          created_at: string
          curso_academico_id: string
          estado: Database["public"]["Enums"]["estado_informe"]
          estructura_snapshot: Json
          id: string
          nino_id: string
          notificado_at: string | null
          observaciones_generales: string | null
          periodo: Database["public"]["Enums"]["periodo_informe"]
          plantilla_id: string
          publicado_at: string | null
          respuestas: Json
          updated_at: string
        }
        Insert: {
          centro_id: string
          creado_por: string
          created_at?: string
          curso_academico_id: string
          estado?: Database["public"]["Enums"]["estado_informe"]
          estructura_snapshot: Json
          id?: string
          nino_id: string
          notificado_at?: string | null
          observaciones_generales?: string | null
          periodo: Database["public"]["Enums"]["periodo_informe"]
          plantilla_id: string
          publicado_at?: string | null
          respuestas?: Json
          updated_at?: string
        }
        Update: {
          centro_id?: string
          creado_por?: string
          created_at?: string
          curso_academico_id?: string
          estado?: Database["public"]["Enums"]["estado_informe"]
          estructura_snapshot?: Json
          id?: string
          nino_id?: string
          notificado_at?: string | null
          observaciones_generales?: string | null
          periodo?: Database["public"]["Enums"]["periodo_informe"]
          plantilla_id?: string
          publicado_at?: string | null
          respuestas?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "informes_evolucion_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "informes_evolucion_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "informes_evolucion_curso_academico_id_fkey"
            columns: ["curso_academico_id"]
            isOneToOne: false
            referencedRelation: "cursos_academicos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "informes_evolucion_nino_id_fkey"
            columns: ["nino_id"]
            isOneToOne: false
            referencedRelation: "ninos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "informes_evolucion_plantilla_id_fkey"
            columns: ["plantilla_id"]
            isOneToOne: false
            referencedRelation: "plantillas_informe"
            referencedColumns: ["id"]
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
          nombre_completo: string | null
          rejected_at: string | null
          rol_objetivo: Database["public"]["Enums"]["user_role"]
          tipo_personal_aula:
            | Database["public"]["Enums"]["tipo_personal_aula"]
            | null
          tipo_vinculo: Database["public"]["Enums"]["tipo_vinculo"] | null
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
          nombre_completo?: string | null
          rejected_at?: string | null
          rol_objetivo: Database["public"]["Enums"]["user_role"]
          tipo_personal_aula?:
            | Database["public"]["Enums"]["tipo_personal_aula"]
            | null
          tipo_vinculo?: Database["public"]["Enums"]["tipo_vinculo"] | null
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
          nombre_completo?: string | null
          rejected_at?: string | null
          rol_objetivo?: Database["public"]["Enums"]["user_role"]
          tipo_personal_aula?:
            | Database["public"]["Enums"]["tipo_personal_aula"]
            | null
          tipo_vinculo?: Database["public"]["Enums"]["tipo_vinculo"] | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitaciones_aula_id_fkey"
            columns: ["aula_id"]
            isOneToOne: false
            referencedRelation: "aulas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitaciones_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitaciones_invitado_por_fkey"
            columns: ["invitado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitaciones_nino_id_fkey"
            columns: ["nino_id"]
            isOneToOne: false
            referencedRelation: "ninos"
            referencedColumns: ["id"]
          },
        ]
      }
      lectura_anuncio: {
        Row: {
          anuncio_id: string
          id: string
          leido_at: string
          usuario_id: string
        }
        Insert: {
          anuncio_id: string
          id?: string
          leido_at: string
          usuario_id: string
        }
        Update: {
          anuncio_id?: string
          id?: string
          leido_at?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lectura_anuncio_anuncio_id_fkey"
            columns: ["anuncio_id"]
            isOneToOne: false
            referencedRelation: "anuncios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lectura_anuncio_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      lectura_conversacion: {
        Row: {
          conversacion_id: string
          id: string
          last_read_at: string
          usuario_id: string
        }
        Insert: {
          conversacion_id: string
          id?: string
          last_read_at: string
          usuario_id: string
        }
        Update: {
          conversacion_id?: string
          id?: string
          last_read_at?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lectura_conversacion_conversacion_id_fkey"
            columns: ["conversacion_id"]
            isOneToOne: false
            referencedRelation: "conversaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lectura_conversacion_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      lineas_recibo: {
        Row: {
          cantidad: number
          centro_id: string
          concepto_id: string | null
          created_at: string
          descripcion: string
          id: string
          importe_centimos: number
          precio_unitario_centimos: number
          recibo_id: string
        }
        Insert: {
          cantidad?: number
          centro_id: string
          concepto_id?: string | null
          created_at?: string
          descripcion: string
          id?: string
          importe_centimos: number
          precio_unitario_centimos: number
          recibo_id: string
        }
        Update: {
          cantidad?: number
          centro_id?: string
          concepto_id?: string | null
          created_at?: string
          descripcion?: string
          id?: string
          importe_centimos?: number
          precio_unitario_centimos?: number
          recibo_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lineas_recibo_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineas_recibo_concepto_id_fkey"
            columns: ["concepto_id"]
            isOneToOne: false
            referencedRelation: "conceptos_cobro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineas_recibo_recibo_id_fkey"
            columns: ["recibo_id"]
            isOneToOne: false
            referencedRelation: "recibos"
            referencedColumns: ["id"]
          },
        ]
      }
      lista_espera: {
        Row: {
          apellidos_nino: string | null
          centro_id: string
          created_at: string
          curso_academico_id: string
          email_tutor: string | null
          estado: Database["public"]["Enums"]["estado_lista_espera"]
          fecha_nacimiento: string | null
          id: string
          nombre_nino: string
          nota: string | null
          posicion: number
          telefono_tutor: string | null
          updated_at: string
        }
        Insert: {
          apellidos_nino?: string | null
          centro_id: string
          created_at?: string
          curso_academico_id: string
          email_tutor?: string | null
          estado?: Database["public"]["Enums"]["estado_lista_espera"]
          fecha_nacimiento?: string | null
          id?: string
          nombre_nino: string
          nota?: string | null
          posicion: number
          telefono_tutor?: string | null
          updated_at?: string
        }
        Update: {
          apellidos_nino?: string | null
          centro_id?: string
          created_at?: string
          curso_academico_id?: string
          email_tutor?: string | null
          estado?: Database["public"]["Enums"]["estado_lista_espera"]
          fecha_nacimiento?: string | null
          id?: string
          nombre_nino?: string
          nota?: string | null
          posicion?: number
          telefono_tutor?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lista_espera_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lista_espera_curso_academico_id_fkey"
            columns: ["curso_academico_id"]
            isOneToOne: false
            referencedRelation: "cursos_academicos"
            referencedColumns: ["id"]
          },
        ]
      }
      mandatos_sepa: {
        Row: {
          centro_id: string
          created_at: string
          deleted_at: string | null
          documento_path: string | null
          estado: Database["public"]["Enums"]["estado_mandato_sepa"]
          familia_id: string | null
          fecha_firma: string | null
          firma_imagen: string | null
          iban_cifrado: string
          id: string
          identificador_mandato: string
          ip_address: unknown
          metodo_firma: Database["public"]["Enums"]["firma_metodo"]
          nino_id: string
          nombre_tecleado: string | null
          texto_hash: string | null
          titular: string
          updated_at: string
          user_agent: string | null
          usuario_id: string
        }
        Insert: {
          centro_id: string
          created_at?: string
          deleted_at?: string | null
          documento_path?: string | null
          estado?: Database["public"]["Enums"]["estado_mandato_sepa"]
          familia_id?: string | null
          fecha_firma?: string | null
          firma_imagen?: string | null
          iban_cifrado: string
          id?: string
          identificador_mandato: string
          ip_address?: unknown
          metodo_firma?: Database["public"]["Enums"]["firma_metodo"]
          nino_id: string
          nombre_tecleado?: string | null
          texto_hash?: string | null
          titular: string
          updated_at?: string
          user_agent?: string | null
          usuario_id: string
        }
        Update: {
          centro_id?: string
          created_at?: string
          deleted_at?: string | null
          documento_path?: string | null
          estado?: Database["public"]["Enums"]["estado_mandato_sepa"]
          familia_id?: string | null
          fecha_firma?: string | null
          firma_imagen?: string | null
          iban_cifrado?: string
          id?: string
          identificador_mandato?: string
          ip_address?: unknown
          metodo_firma?: Database["public"]["Enums"]["firma_metodo"]
          nino_id?: string
          nombre_tecleado?: string | null
          texto_hash?: string | null
          titular?: string
          updated_at?: string
          user_agent?: string | null
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mandatos_sepa_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandatos_sepa_familia_id_fkey"
            columns: ["familia_id"]
            isOneToOne: false
            referencedRelation: "familias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandatos_sepa_nino_id_fkey"
            columns: ["nino_id"]
            isOneToOne: false
            referencedRelation: "ninos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandatos_sepa_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      matriculas: {
        Row: {
          aula_id: string
          created_at: string
          curso_academico_id: string
          deleted_at: string | null
          estado: Database["public"]["Enums"]["matricula_estado"]
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
          estado?: Database["public"]["Enums"]["matricula_estado"]
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
          estado?: Database["public"]["Enums"]["matricula_estado"]
          fecha_alta?: string
          fecha_baja?: string | null
          id?: string
          motivo_baja?: string | null
          nino_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "matriculas_aula_curso_fkey"
            columns: ["aula_id", "curso_academico_id"]
            isOneToOne: false
            referencedRelation: "aulas_curso"
            referencedColumns: ["aula_id", "curso_academico_id"]
          },
          {
            foreignKeyName: "matriculas_nino_id_fkey"
            columns: ["nino_id"]
            isOneToOne: false
            referencedRelation: "ninos"
            referencedColumns: ["id"]
          },
        ]
      }
      media: {
        Row: {
          alto: number | null
          ancho: number | null
          bucket: string
          bytes: number | null
          centro_id: string
          created_at: string
          hash: string | null
          id: string
          mime: string
          path: string
          path_miniatura: string | null
          publicacion_id: string
        }
        Insert: {
          alto?: number | null
          ancho?: number | null
          bucket: string
          bytes?: number | null
          centro_id: string
          created_at?: string
          hash?: string | null
          id?: string
          mime: string
          path: string
          path_miniatura?: string | null
          publicacion_id: string
        }
        Update: {
          alto?: number | null
          ancho?: number | null
          bucket?: string
          bytes?: number | null
          centro_id?: string
          created_at?: string
          hash?: string | null
          id?: string
          mime?: string
          path?: string
          path_miniatura?: string | null
          publicacion_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_publicacion_id_fkey"
            columns: ["publicacion_id"]
            isOneToOne: false
            referencedRelation: "publicaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      media_etiquetas: {
        Row: {
          centro_id: string
          created_at: string
          id: string
          media_id: string
          nino_id: string
        }
        Insert: {
          centro_id: string
          created_at?: string
          id?: string
          media_id: string
          nino_id: string
        }
        Update: {
          centro_id?: string
          created_at?: string
          id?: string
          media_id?: string
          nino_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_etiquetas_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_etiquetas_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_etiquetas_nino_id_fkey"
            columns: ["nino_id"]
            isOneToOne: false
            referencedRelation: "ninos"
            referencedColumns: ["id"]
          },
        ]
      }
      mensajes: {
        Row: {
          autor_id: string
          contenido: string
          conversacion_id: string
          created_at: string
          erroneo: boolean
          id: string
          updated_at: string
        }
        Insert: {
          autor_id: string
          contenido: string
          conversacion_id: string
          created_at?: string
          erroneo?: boolean
          id?: string
          updated_at?: string
        }
        Update: {
          autor_id?: string
          contenido?: string
          conversacion_id?: string
          created_at?: string
          erroneo?: boolean
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mensajes_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensajes_conversacion_id_fkey"
            columns: ["conversacion_id"]
            isOneToOne: false
            referencedRelation: "conversaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_dia: {
        Row: {
          comida_postre: string | null
          comida_primero: string | null
          comida_segundo: string | null
          created_at: string
          desayuno: string | null
          fecha: string
          id: string
          media_manana: string | null
          merienda: string | null
          plantilla_id: string
          updated_at: string
        }
        Insert: {
          comida_postre?: string | null
          comida_primero?: string | null
          comida_segundo?: string | null
          created_at?: string
          desayuno?: string | null
          fecha: string
          id?: string
          media_manana?: string | null
          merienda?: string | null
          plantilla_id: string
          updated_at?: string
        }
        Update: {
          comida_postre?: string | null
          comida_primero?: string | null
          comida_segundo?: string | null
          created_at?: string
          desayuno?: string | null
          fecha?: string
          id?: string
          media_manana?: string | null
          merienda?: string | null
          plantilla_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_dia_plantilla_id_fkey"
            columns: ["plantilla_id"]
            isOneToOne: false
            referencedRelation: "plantillas_menu_mensual"
            referencedColumns: ["id"]
          },
        ]
      }
      metodo_pago_familia: {
        Row: {
          anio: number
          centro_id: string
          created_at: string
          deleted_at: string | null
          familia_id: string | null
          id: string
          mes: number
          metodo: Database["public"]["Enums"]["metodo_pago"]
          nino_id: string
          updated_at: string
        }
        Insert: {
          anio: number
          centro_id: string
          created_at?: string
          deleted_at?: string | null
          familia_id?: string | null
          id?: string
          mes: number
          metodo: Database["public"]["Enums"]["metodo_pago"]
          nino_id: string
          updated_at?: string
        }
        Update: {
          anio?: number
          centro_id?: string
          created_at?: string
          deleted_at?: string | null
          familia_id?: string | null
          id?: string
          mes?: number
          metodo?: Database["public"]["Enums"]["metodo_pago"]
          nino_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "metodo_pago_familia_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metodo_pago_familia_familia_id_fkey"
            columns: ["familia_id"]
            isOneToOne: false
            referencedRelation: "familias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metodo_pago_familia_nino_id_fkey"
            columns: ["nino_id"]
            isOneToOne: false
            referencedRelation: "ninos"
            referencedColumns: ["id"]
          },
        ]
      }
      ninos: {
        Row: {
          apellidos: string | null
          centro_id: string
          created_at: string
          deleted_at: string | null
          direccion_calle: string | null
          direccion_ciudad: string | null
          direccion_cp: string | null
          direccion_numero: string | null
          estado_civil_familia:
            | Database["public"]["Enums"]["estado_civil"]
            | null
          familia_id: string | null
          fecha_nacimiento: string | null
          foto_url: string | null
          id: string
          idioma_principal: string
          libro_familia_path: string | null
          nacionalidad: string | null
          nombre: string
          notas_admin: string | null
          puede_aparecer_en_fotos: boolean
          requiere_ambos_firmantes: boolean
          sexo: Database["public"]["Enums"]["nino_sexo"] | null
          updated_at: string
        }
        Insert: {
          apellidos?: string | null
          centro_id: string
          created_at?: string
          deleted_at?: string | null
          direccion_calle?: string | null
          direccion_ciudad?: string | null
          direccion_cp?: string | null
          direccion_numero?: string | null
          estado_civil_familia?:
            | Database["public"]["Enums"]["estado_civil"]
            | null
          familia_id?: string | null
          fecha_nacimiento?: string | null
          foto_url?: string | null
          id?: string
          idioma_principal?: string
          libro_familia_path?: string | null
          nacionalidad?: string | null
          nombre: string
          notas_admin?: string | null
          puede_aparecer_en_fotos?: boolean
          requiere_ambos_firmantes?: boolean
          sexo?: Database["public"]["Enums"]["nino_sexo"] | null
          updated_at?: string
        }
        Update: {
          apellidos?: string | null
          centro_id?: string
          created_at?: string
          deleted_at?: string | null
          direccion_calle?: string | null
          direccion_ciudad?: string | null
          direccion_cp?: string | null
          direccion_numero?: string | null
          estado_civil_familia?:
            | Database["public"]["Enums"]["estado_civil"]
            | null
          familia_id?: string | null
          fecha_nacimiento?: string | null
          foto_url?: string | null
          id?: string
          idioma_principal?: string
          libro_familia_path?: string | null
          nacionalidad?: string | null
          nombre?: string
          notas_admin?: string | null
          puede_aparecer_en_fotos?: boolean
          requiere_ambos_firmantes?: boolean
          sexo?: Database["public"]["Enums"]["nino_sexo"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ninos_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ninos_familia_id_fkey"
            columns: ["familia_id"]
            isOneToOne: false
            referencedRelation: "familias"
            referencedColumns: ["id"]
          },
        ]
      }
      olvido_solicitudes: {
        Row: {
          centro_id: string
          created_at: string
          gracia_hasta: string
          id: string
          inmediato: boolean
          purgado_en: string | null
          solicitado_en: string
          solicitado_por: string | null
          sujeto_id: string
          sujeto_tipo: Database["public"]["Enums"]["olvido_sujeto_tipo"]
        }
        Insert: {
          centro_id: string
          created_at?: string
          gracia_hasta: string
          id?: string
          inmediato?: boolean
          purgado_en?: string | null
          solicitado_en?: string
          solicitado_por?: string | null
          sujeto_id: string
          sujeto_tipo: Database["public"]["Enums"]["olvido_sujeto_tipo"]
        }
        Update: {
          centro_id?: string
          created_at?: string
          gracia_hasta?: string
          id?: string
          inmediato?: boolean
          purgado_en?: string | null
          solicitado_en?: string
          solicitado_por?: string | null
          sujeto_id?: string
          sujeto_tipo?: Database["public"]["Enums"]["olvido_sujeto_tipo"]
        }
        Relationships: [
          {
            foreignKeyName: "olvido_solicitudes_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "olvido_solicitudes_solicitado_por_fkey"
            columns: ["solicitado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      parte_servicio_diario: {
        Row: {
          centro_id: string
          created_at: string
          fecha: string
          id: string
          nino_id: string
          presente: boolean
          servicio: Database["public"]["Enums"]["servicio_diario"]
          updated_at: string
        }
        Insert: {
          centro_id: string
          created_at?: string
          fecha: string
          id?: string
          nino_id: string
          presente?: boolean
          servicio: Database["public"]["Enums"]["servicio_diario"]
          updated_at?: string
        }
        Update: {
          centro_id?: string
          created_at?: string
          fecha?: string
          id?: string
          nino_id?: string
          presente?: boolean
          servicio?: Database["public"]["Enums"]["servicio_diario"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "parte_servicio_diario_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parte_servicio_diario_nino_id_fkey"
            columns: ["nino_id"]
            isOneToOne: false
            referencedRelation: "ninos"
            referencedColumns: ["id"]
          },
        ]
      }
      plantillas_informe: {
        Row: {
          archivada_at: string | null
          archivada_por: string | null
          centro_id: string
          creado_por: string
          created_at: string
          estado: Database["public"]["Enums"]["estado_plantilla_informe"]
          estructura: Json
          id: string
          titulo: string
          updated_at: string
        }
        Insert: {
          archivada_at?: string | null
          archivada_por?: string | null
          centro_id: string
          creado_por: string
          created_at?: string
          estado?: Database["public"]["Enums"]["estado_plantilla_informe"]
          estructura?: Json
          id?: string
          titulo: string
          updated_at?: string
        }
        Update: {
          archivada_at?: string | null
          archivada_por?: string | null
          centro_id?: string
          creado_por?: string
          created_at?: string
          estado?: Database["public"]["Enums"]["estado_plantilla_informe"]
          estructura?: Json
          id?: string
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plantillas_informe_archivada_por_fkey"
            columns: ["archivada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plantillas_informe_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plantillas_informe_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      plantillas_menu_mensual: {
        Row: {
          anio: number
          centro_id: string
          creada_por: string | null
          created_at: string
          deleted_at: string | null
          estado: Database["public"]["Enums"]["estado_plantilla_menu"]
          id: string
          mes: number
          updated_at: string
        }
        Insert: {
          anio: number
          centro_id: string
          creada_por?: string | null
          created_at?: string
          deleted_at?: string | null
          estado?: Database["public"]["Enums"]["estado_plantilla_menu"]
          id?: string
          mes: number
          updated_at?: string
        }
        Update: {
          anio?: number
          centro_id?: string
          creada_por?: string | null
          created_at?: string
          deleted_at?: string | null
          estado?: Database["public"]["Enums"]["estado_plantilla_menu"]
          id?: string
          mes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plantillas_menu_mensual_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plantillas_menu_mensual_creada_por_fkey"
            columns: ["creada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      preferencias_usuario: {
        Row: {
          clave: string
          updated_at: string
          usuario_id: string
          valor: string
        }
        Insert: {
          clave: string
          updated_at?: string
          usuario_id: string
          valor: string
        }
        Update: {
          clave?: string
          updated_at?: string
          usuario_id?: string
          valor?: string
        }
        Relationships: [
          {
            foreignKeyName: "preferencias_usuario_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      profes_aulas: {
        Row: {
          aula_id: string
          created_at: string
          curso_academico_id: string
          deleted_at: string | null
          es_profe_principal: boolean
          fecha_fin: string | null
          fecha_inicio: string
          id: string
          profe_id: string
          tipo_personal_aula: Database["public"]["Enums"]["tipo_personal_aula"]
        }
        Insert: {
          aula_id: string
          created_at?: string
          curso_academico_id: string
          deleted_at?: string | null
          es_profe_principal?: boolean
          fecha_fin?: string | null
          fecha_inicio?: string
          id?: string
          profe_id: string
          tipo_personal_aula?: Database["public"]["Enums"]["tipo_personal_aula"]
        }
        Update: {
          aula_id?: string
          created_at?: string
          curso_academico_id?: string
          deleted_at?: string | null
          es_profe_principal?: boolean
          fecha_fin?: string | null
          fecha_inicio?: string
          id?: string
          profe_id?: string
          tipo_personal_aula?: Database["public"]["Enums"]["tipo_personal_aula"]
        }
        Relationships: [
          {
            foreignKeyName: "profes_aulas_aula_id_fkey"
            columns: ["aula_id"]
            isOneToOne: false
            referencedRelation: "aulas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profes_aulas_curso_academico_id_fkey"
            columns: ["curso_academico_id"]
            isOneToOne: false
            referencedRelation: "cursos_academicos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profes_aulas_profe_id_fkey"
            columns: ["profe_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      publicaciones: {
        Row: {
          aula_id: string
          autor_id: string
          centro_id: string
          created_at: string
          id: string
          texto: string | null
          updated_at: string
        }
        Insert: {
          aula_id: string
          autor_id: string
          centro_id: string
          created_at?: string
          id?: string
          texto?: string | null
          updated_at?: string
        }
        Update: {
          aula_id?: string
          autor_id?: string
          centro_id?: string
          created_at?: string
          id?: string
          texto?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "publicaciones_aula_id_fkey"
            columns: ["aula_id"]
            isOneToOne: false
            referencedRelation: "aulas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publicaciones_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publicaciones_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_active_at: string
          p256dh: string
          updated_at: string
          user_agent: string | null
          usuario_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_active_at?: string
          p256dh: string
          updated_at?: string
          user_agent?: string | null
          usuario_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_active_at?: string
          p256dh?: string
          updated_at?: string
          user_agent?: string | null
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      recibos: {
        Row: {
          anio: number
          centro_id: string
          concepto_esporadico: string | null
          created_at: string
          deleted_at: string | null
          devuelto_de_recibo_id: string | null
          es_esporadico: boolean
          estado: Database["public"]["Enums"]["estado_recibo"]
          familia_id: string | null
          fecha_devolucion: string | null
          fecha_envio_banco: string | null
          id: string
          mes: number
          metodo: Database["public"]["Enums"]["metodo_pago"] | null
          nino_id: string
          total_centimos: number
          updated_at: string
        }
        Insert: {
          anio: number
          centro_id: string
          concepto_esporadico?: string | null
          created_at?: string
          deleted_at?: string | null
          devuelto_de_recibo_id?: string | null
          es_esporadico?: boolean
          estado?: Database["public"]["Enums"]["estado_recibo"]
          familia_id?: string | null
          fecha_devolucion?: string | null
          fecha_envio_banco?: string | null
          id?: string
          mes: number
          metodo?: Database["public"]["Enums"]["metodo_pago"] | null
          nino_id: string
          total_centimos?: number
          updated_at?: string
        }
        Update: {
          anio?: number
          centro_id?: string
          concepto_esporadico?: string | null
          created_at?: string
          deleted_at?: string | null
          devuelto_de_recibo_id?: string | null
          es_esporadico?: boolean
          estado?: Database["public"]["Enums"]["estado_recibo"]
          familia_id?: string | null
          fecha_devolucion?: string | null
          fecha_envio_banco?: string | null
          id?: string
          mes?: number
          metodo?: Database["public"]["Enums"]["metodo_pago"] | null
          nino_id?: string
          total_centimos?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recibos_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recibos_devuelto_de_recibo_id_fkey"
            columns: ["devuelto_de_recibo_id"]
            isOneToOne: false
            referencedRelation: "recibos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recibos_familia_id_fkey"
            columns: ["familia_id"]
            isOneToOne: false
            referencedRelation: "familias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recibos_nino_id_fkey"
            columns: ["nino_id"]
            isOneToOne: false
            referencedRelation: "ninos"
            referencedColumns: ["id"]
          },
        ]
      }
      recibos_remesa: {
        Row: {
          centro_id: string
          created_at: string
          id: string
          recibo_id: string
          remesa_id: string
        }
        Insert: {
          centro_id: string
          created_at?: string
          id?: string
          recibo_id: string
          remesa_id: string
        }
        Update: {
          centro_id?: string
          created_at?: string
          id?: string
          recibo_id?: string
          remesa_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recibos_remesa_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recibos_remesa_recibo_id_fkey"
            columns: ["recibo_id"]
            isOneToOne: false
            referencedRelation: "recibos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recibos_remesa_remesa_id_fkey"
            columns: ["remesa_id"]
            isOneToOne: false
            referencedRelation: "remesas"
            referencedColumns: ["id"]
          },
        ]
      }
      recordatorios: {
        Row: {
          aula_id: string | null
          centro_id: string
          completado_en: string | null
          completado_por: string | null
          creado_por: string
          created_at: string
          descripcion: string | null
          destinatario: Database["public"]["Enums"]["recordatorio_destinatario"]
          erroneo: boolean
          id: string
          nino_id: string | null
          titulo: string
          updated_at: string
          usuario_destinatario_id: string | null
          vencimiento: string | null
        }
        Insert: {
          aula_id?: string | null
          centro_id: string
          completado_en?: string | null
          completado_por?: string | null
          creado_por: string
          created_at?: string
          descripcion?: string | null
          destinatario: Database["public"]["Enums"]["recordatorio_destinatario"]
          erroneo?: boolean
          id?: string
          nino_id?: string | null
          titulo: string
          updated_at?: string
          usuario_destinatario_id?: string | null
          vencimiento?: string | null
        }
        Update: {
          aula_id?: string | null
          centro_id?: string
          completado_en?: string | null
          completado_por?: string | null
          creado_por?: string
          created_at?: string
          descripcion?: string | null
          destinatario?: Database["public"]["Enums"]["recordatorio_destinatario"]
          erroneo?: boolean
          id?: string
          nino_id?: string | null
          titulo?: string
          updated_at?: string
          usuario_destinatario_id?: string | null
          vencimiento?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recordatorios_aula_id_fkey"
            columns: ["aula_id"]
            isOneToOne: false
            referencedRelation: "aulas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recordatorios_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recordatorios_completado_por_fkey"
            columns: ["completado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recordatorios_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recordatorios_nino_id_fkey"
            columns: ["nino_id"]
            isOneToOne: false
            referencedRelation: "ninos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recordatorios_usuario_destinatario_id_fkey"
            columns: ["usuario_destinatario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      remesas: {
        Row: {
          anio: number
          centro_id: string
          created_at: string
          deleted_at: string | null
          estado: Database["public"]["Enums"]["estado_remesa"]
          fecha_envio_banco: string | null
          id: string
          mes: number
          updated_at: string
        }
        Insert: {
          anio: number
          centro_id: string
          created_at?: string
          deleted_at?: string | null
          estado?: Database["public"]["Enums"]["estado_remesa"]
          fecha_envio_banco?: string | null
          id?: string
          mes: number
          updated_at?: string
        }
        Update: {
          anio?: number
          centro_id?: string
          created_at?: string
          deleted_at?: string | null
          estado?: Database["public"]["Enums"]["estado_remesa"]
          fecha_envio_banco?: string | null
          id?: string
          mes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "remesas_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
        ]
      }
      retencion_ejecuciones: {
        Row: {
          accion: Database["public"]["Enums"]["retencion_accion"]
          bucket: string
          categoria: Database["public"]["Enums"]["retencion_categoria"]
          centro_id: string
          ejecutado_en: string
          id: string
          motivo: string | null
          objetos: number
          ref_id: string | null
          ref_tipo: string | null
        }
        Insert: {
          accion: Database["public"]["Enums"]["retencion_accion"]
          bucket: string
          categoria: Database["public"]["Enums"]["retencion_categoria"]
          centro_id: string
          ejecutado_en?: string
          id?: string
          motivo?: string | null
          objetos?: number
          ref_id?: string | null
          ref_tipo?: string | null
        }
        Update: {
          accion?: Database["public"]["Enums"]["retencion_accion"]
          bucket?: string
          categoria?: Database["public"]["Enums"]["retencion_categoria"]
          centro_id?: string
          ejecutado_en?: string
          id?: string
          motivo?: string | null
          objetos?: number
          ref_id?: string | null
          ref_tipo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "retencion_ejecuciones_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
        ]
      }
      roles_usuario: {
        Row: {
          centro_id: string
          created_at: string
          deleted_at: string | null
          id: string
          rol: Database["public"]["Enums"]["user_role"]
          usuario_id: string
        }
        Insert: {
          centro_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          rol: Database["public"]["Enums"]["user_role"]
          usuario_id: string
        }
        Update: {
          centro_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          rol?: Database["public"]["Enums"]["user_role"]
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_usuario_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roles_usuario_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      suenos: {
        Row: {
          agenda_id: string
          calidad: Database["public"]["Enums"]["calidad_sueno"] | null
          created_at: string
          hora_fin: string | null
          hora_inicio: string
          id: string
          observaciones: string | null
          updated_at: string
        }
        Insert: {
          agenda_id: string
          calidad?: Database["public"]["Enums"]["calidad_sueno"] | null
          created_at?: string
          hora_fin?: string | null
          hora_inicio: string
          id?: string
          observaciones?: string | null
          updated_at?: string
        }
        Update: {
          agenda_id?: string
          calidad?: Database["public"]["Enums"]["calidad_sueno"] | null
          created_at?: string
          hora_fin?: string | null
          hora_inicio?: string
          id?: string
          observaciones?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suenos_agenda_id_fkey"
            columns: ["agenda_id"]
            isOneToOne: false
            referencedRelation: "agendas_diarias"
            referencedColumns: ["id"]
          },
        ]
      }
      tipos_beca: {
        Row: {
          activo: boolean
          centro_id: string
          created_at: string
          deleted_at: string | null
          id: string
          nombre: string
          updated_at: string
        }
        Insert: {
          activo?: boolean
          centro_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          nombre: string
          updated_at?: string
        }
        Update: {
          activo?: boolean
          centro_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          nombre?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tipos_beca_centro_id_fkey"
            columns: ["centro_id"]
            isOneToOne: false
            referencedRelation: "centros"
            referencedColumns: ["id"]
          },
        ]
      }
      usuarios: {
        Row: {
          consentimiento_privacidad_version: string | null
          consentimiento_terminos_version: string | null
          created_at: string
          deleted_at: string | null
          foto_url: string | null
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
          foto_url?: string | null
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
          foto_url?: string | null
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
          parentesco: Database["public"]["Enums"]["parentesco"]
          permisos: Json
          tipo_vinculo: Database["public"]["Enums"]["tipo_vinculo"]
          updated_at: string
          usuario_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          descripcion_parentesco?: string | null
          id?: string
          nino_id: string
          parentesco: Database["public"]["Enums"]["parentesco"]
          permisos?: Json
          tipo_vinculo: Database["public"]["Enums"]["tipo_vinculo"]
          updated_at?: string
          usuario_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          descripcion_parentesco?: string | null
          id?: string
          nino_id?: string
          parentesco?: Database["public"]["Enums"]["parentesco"]
          permisos?: Json
          tipo_vinculo?: Database["public"]["Enums"]["tipo_vinculo"]
          updated_at?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vinculos_familiares_nino_id_fkey"
            columns: ["nino_id"]
            isOneToOne: false
            referencedRelation: "ninos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vinculos_familiares_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _get_medical_key: { Args: never; Returns: string }
      _get_sepa_key: { Args: never; Returns: string }
      _redactar_jsonb: { Args: { claves: string[]; j: Json }; Returns: Json }
      actualizar_foto_nino_tutor: {
        Args: { p_foto_path: string; p_nino_id: string }
        Returns: string
      }
      actualizar_identidad_nino_tutor: {
        Args: {
          p_apellidos: string
          p_fecha_nacimiento: string
          p_idioma_principal: string
          p_nacionalidad: string
          p_nino_id: string
          p_nombre?: string
          p_sexo: Database["public"]["Enums"]["nino_sexo"]
        }
        Returns: string
      }
      archivar_autorizacion: {
        Args: { p_autorizacion_id: string }
        Returns: boolean
      }
      aula_de_publicacion: {
        Args: { p_publicacion_id: string }
        Returns: string
      }
      autor_de_publicacion: {
        Args: { p_publicacion_id: string }
        Returns: string
      }
      autorizacion_aplica_a_nino: {
        Args: { p_autorizacion_id: string; p_nino_id: string }
        Returns: boolean
      }
      autorizacion_firmable: {
        Args: { p_autorizacion_id: string }
        Returns: boolean
      }
      autorizacion_plantilla_valida: {
        Args: {
          p_centro_id: string
          p_plantilla_id: string
          p_tipo: Database["public"]["Enums"]["tipo_autorizacion"]
        }
        Returns: boolean
      }
      borrar_info_medica_nino_tutor: {
        Args: { p_nino_id: string }
        Returns: undefined
      }
      centro_abierto: {
        Args: { p_centro_id: string; p_fecha: string }
        Returns: boolean
      }
      centro_de_agenda: { Args: { p_agenda_id: string }; Returns: string }
      centro_de_aula: { Args: { p_aula_id: string }; Returns: string }
      centro_de_cita: { Args: { p_cita_id: string }; Returns: string }
      centro_de_conversacion: {
        Args: { p_conversacion_id: string }
        Returns: string
      }
      centro_de_curso: { Args: { p_curso_id: string }; Returns: string }
      centro_de_evento: { Args: { p_evento_id: string }; Returns: string }
      centro_de_familia: { Args: { p_familia_id: string }; Returns: string }
      centro_de_nino: { Args: { p_nino_id: string }; Returns: string }
      centro_de_plantilla: { Args: { p_plantilla_id: string }; Returns: string }
      centro_de_publicacion: {
        Args: { p_publicacion_id: string }
        Returns: string
      }
      centro_de_recibo: { Args: { p_recibo_id: string }; Returns: string }
      centro_de_remesa: { Args: { p_remesa_id: string }; Returns: string }
      cerrar_mes_cobros: {
        Args: { p_anio: number; p_centro_id: string; p_mes: number }
        Returns: string
      }
      contar_invitaciones_pendientes: { Args: never; Returns: number }
      contar_recordatorios_pendientes: { Args: never; Returns: number }
      conversacion_activa: { Args: { p_conv_id: string }; Returns: boolean }
      crear_recibo_esporadico: {
        Args: {
          p_anio: number
          p_centro_id: string
          p_concepto: string
          p_lineas: Json
          p_mes: number
          p_metodo: string
          p_nino_id: string
        }
        Returns: string
      }
      curso_activo_de_centro: { Args: { p_centro_id: string }; Returns: string }
      dentro_de_ventana_edicion: { Args: { p_fecha: string }; Returns: boolean }
      es_admin: { Args: { p_centro_id?: string }; Returns: boolean }
      es_esqueleto_stub_purgable: {
        Args: { p_cutoff: string; p_usuario_id: string }
        Returns: boolean
      }
      es_profe_de_aula: { Args: { p_aula_id: string }; Returns: boolean }
      es_profe_de_evento: { Args: { p_evento_id: string }; Returns: boolean }
      es_profe_de_nino: { Args: { p_nino_id: string }; Returns: boolean }
      es_profe_en_centro: { Args: { p_centro_id: string }; Returns: boolean }
      es_redactor_de_aula: { Args: { p_aula_id: string }; Returns: boolean }
      es_redactor_de_nino: { Args: { p_nino_id: string }; Returns: boolean }
      es_tutor_de: { Args: { p_nino_id: string }; Returns: boolean }
      es_tutor_de_familia: { Args: { p_familia_id: string }; Returns: boolean }
      es_tutor_en_aula: { Args: { p_aula_id: string }; Returns: boolean }
      es_tutor_en_centro: {
        Args: { p_centro_id: string; p_tutor_id: string }
        Returns: boolean
      }
      es_tutor_legal_de: { Args: { p_nino_id: string }; Returns: boolean }
      evento_aplica_a_nino: {
        Args: { p_evento_id: string; p_nino_id: string }
        Returns: boolean
      }
      familia_de_nino: { Args: { p_nino_id: string }; Returns: string }
      familia_ve_aula: { Args: { p_aula_id: string }; Returns: boolean }
      fecha_de_agenda: { Args: { p_agenda_id: string }; Returns: string }
      get_datos_acreedor: {
        Args: { p_centro_id: string }
        Returns: {
          bic_acreedor: string
          iban: string
          identificador_acreedor: string
        }[]
      }
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
      get_mandatos_remesa: {
        Args: { p_remesa_id: string }
        Returns: {
          fecha_mandato: string
          iban: string
          identificador_mandato: string
          nino_id: string
          recibo_id: string
          titular: string
          total_centimos: number
        }[]
      }
      hoy_madrid: { Args: never; Returns: string }
      idiomas_iso_2letras: { Args: { p_codigos: string[] }; Returns: boolean }
      imagen_consentida: {
        Args: { p_autorizacion_id: string; p_nino_id: string }
        Returns: boolean
      }
      listar_esqueletos_huerfanos_stub: {
        Args: { p_cutoff: string }
        Returns: {
          centro_id: string
          usuario_id: string
        }[]
      }
      marcar_matricula_lista: { Args: { p_nino_id: string }; Returns: string }
      medicacion_administrable_hoy: {
        Args: { p_autorizacion_id: string }
        Returns: boolean
      }
      menu_del_dia: {
        Args: { p_centro_id: string; p_fecha: string }
        Returns: {
          comida_postre: string | null
          comida_primero: string | null
          comida_segundo: string | null
          created_at: string
          desayuno: string | null
          fecha: string
          id: string
          media_manana: string | null
          merienda: string | null
          plantilla_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "menu_dia"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mes_cerrado: {
        Args: { p_anio: number; p_centro_id: string; p_mes: number }
        Returns: boolean
      }
      nino_de_agenda: { Args: { p_agenda_id: string }; Returns: string }
      nino_de_conversacion: {
        Args: { p_conversacion_id: string }
        Returns: string
      }
      nino_de_recibo: { Args: { p_recibo_id: string }; Returns: string }
      nino_puede_aparecer: { Args: { p_nino_id: string }; Returns: boolean }
      nino_toma_comida_solida: { Args: { p_nino_id: string }; Returns: boolean }
      olvido_pendientes: {
        Args: never
        Returns: {
          centro_id: string
          gracia_hasta: string
          solicitud_id: string
          sujeto_id: string
          sujeto_tipo: Database["public"]["Enums"]["olvido_sujeto_tipo"]
        }[]
      }
      organizador_de_cita: { Args: { p_cita_id: string }; Returns: string }
      pertenece_a_centro: { Args: { p_centro_id: string }; Returns: boolean }
      publicacion_de_media: { Args: { p_media_id: string }; Returns: string }
      publicacion_etiqueta_hijo_de: {
        Args: { p_publicacion_id: string }
        Returns: boolean
      }
      publicacion_tiene_nino_sin_permiso: {
        Args: { p_publicacion_id: string }
        Returns: boolean
      }
      puede_participar_conversacion: {
        Args: { p_conversacion_id: string }
        Returns: boolean
      }
      puede_postear_en_conversacion: {
        Args: { p_conversacion_id: string }
        Returns: boolean
      }
      purgar_esqueleto_huerfano_nino: {
        Args: { p_cutoff: string; p_nino_id: string }
        Returns: undefined
      }
      purgar_sujeto_db: { Args: { p_solicitud_id: string }; Returns: undefined }
      registrar_consentimiento: {
        Args: {
          p_ip?: unknown
          p_metodo?: Database["public"]["Enums"]["firma_metodo"]
          p_tipo: Database["public"]["Enums"]["consentimiento_tipo"]
          p_user_agent?: string
          p_usuario_id: string
          p_version: string
        }
        Returns: string
      }
      registrar_mandato_sepa: {
        Args: {
          p_documento_path: string
          p_fecha_firma: string
          p_firma_imagen: string
          p_iban: string
          p_identificador_mandato: string
          p_ip_address: unknown
          p_metodo?: Database["public"]["Enums"]["firma_metodo"]
          p_nino_id: string
          p_nombre_tecleado: string
          p_texto_hash: string
          p_titular: string
          p_user_agent: string
        }
        Returns: string
      }
      revocar_consentimiento: {
        Args: { p_tipo: Database["public"]["Enums"]["consentimiento_tipo"] }
        Returns: string
      }
      set_datos_acreedor: {
        Args: {
          p_bic_acreedor: string
          p_centro_id: string
          p_iban: string
          p_identificador_acreedor: string
        }
        Returns: undefined
      }
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
      set_info_medica_emergencia_cifrada_tutor: {
        Args: {
          p_alergias_graves: string
          p_alergias_leves: string
          p_medicacion_habitual: string
          p_medico_familia: string
          p_nino_id: string
          p_notas_emergencia: string
          p_reemplazar?: boolean
          p_telefono_emergencia: string
        }
        Returns: string
      }
      solicitar_olvido_nino: {
        Args: { p_inmediato?: boolean; p_nino_id: string }
        Returns: string
      }
      solicitar_olvido_usuario: {
        Args: { p_inmediato?: boolean; p_usuario_id: string }
        Returns: string
      }
      tiene_consentimiento: {
        Args: {
          p_tipo: Database["public"]["Enums"]["consentimiento_tipo"]
          p_usuario_id: string
        }
        Returns: boolean
      }
      tiene_permiso_sobre: {
        Args: { p_nino_id: string; p_permiso: string }
        Returns: boolean
      }
      tipo_de_dia: {
        Args: { p_centro_id: string; p_fecha: string }
        Returns: Database["public"]["Enums"]["tipo_dia_centro"]
      }
      usuario_actual: { Args: never; Returns: string }
      usuario_es_audiencia_anuncio: {
        Args: { p_anuncio_id: string }
        Returns: boolean
      }
      usuario_es_audiencia_anuncio_row: {
        Args: {
          p_ambito: Database["public"]["Enums"]["ambito_anuncio"]
          p_aula_id: string
          p_autor_id: string
          p_centro_id: string
        }
        Returns: boolean
      }
      usuario_es_audiencia_autorizacion_row: {
        Args: {
          p_ambito: Database["public"]["Enums"]["autorizacion_ambito"]
          p_aula_id: string
          p_centro_id: string
          p_es_plantilla: boolean
          p_evento_id: string
          p_nino_id: string
          p_tipo: Database["public"]["Enums"]["tipo_autorizacion"]
        }
        Returns: boolean
      }
      usuario_es_audiencia_cita_row: {
        Args: {
          p_centro_id: string
          p_cita_id: string
          p_organizador_id: string
        }
        Returns: boolean
      }
      usuario_es_audiencia_evento_row: {
        Args: {
          p_ambito: Database["public"]["Enums"]["ambito_evento"]
          p_aula_id: string
          p_centro_id: string
          p_nino_id: string
        }
        Returns: boolean
      }
      usuario_es_audiencia_informe_row: {
        Args: {
          p_centro_id: string
          p_estado: Database["public"]["Enums"]["estado_informe"]
          p_nino_id: string
        }
        Returns: boolean
      }
      usuario_es_invitado_cita: {
        Args: { p_cita_id: string }
        Returns: boolean
      }
      usuario_ve_publicacion_row: {
        Args: {
          p_aula_id: string
          p_centro_id: string
          p_publicacion_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      ambito_anuncio: "aula" | "centro"
      ambito_evento: "centro" | "aula" | "nino"
      audit_accion: "INSERT" | "UPDATE" | "DELETE"
      autorizacion_ambito: "nino" | "aula" | "centro"
      autorizacion_estado: "borrador" | "publicada" | "anulada"
      calidad_sueno: "profundo" | "tranquilo" | "intermitente" | "nada"
      cantidad_comida: "todo" | "mayoria" | "mitad" | "poco" | "nada"
      cantidad_deposicion: "mucha" | "normal" | "poca"
      cita_estado: "programada" | "cancelada"
      confirmacion_estado: "pendiente" | "confirmado" | "rechazado"
      consentimiento_tipo:
        | "terminos"
        | "privacidad"
        | "imagen"
        | "datos_medicos"
      consistencia_deposicion: "normal" | "dura" | "blanda" | "diarrea"
      control_esfinteres:
        | "panal_completo"
        | "transicion"
        | "sin_panal_diurno"
        | "sin_panal_total"
      curso_estado: "planificado" | "activo" | "cerrado"
      estado_asistencia:
        | "presente"
        | "ausente"
        | "llegada_tarde"
        | "salida_temprana"
      estado_cambio_pendiente: "pendiente" | "aprobado" | "rechazado"
      estado_campana_informe: "abierta" | "cerrada"
      estado_civil:
        | "casados"
        | "separados"
        | "divorciados"
        | "pareja_de_hecho"
        | "soltero"
        | "viudo"
      estado_general_agenda: "bien" | "regular" | "mal" | "mixto"
      estado_informe: "borrador" | "publicado"
      estado_lista_espera: "en_espera" | "invitado" | "descartado"
      estado_mandato_sepa: "activo" | "revocado"
      estado_plantilla_informe: "activa" | "archivada"
      estado_plantilla_menu: "borrador" | "publicada" | "archivada"
      estado_recibo:
        | "pendiente_procesar"
        | "enviado_banco"
        | "devuelto"
        | "cobrado_manual"
      estado_remesa: "borrador" | "enviada"
      evento_estado: "programado" | "cancelado"
      firma_decision: "firmado" | "rechazado" | "revocado"
      firma_metodo: "digital" | "presencial"
      humor_agenda: "feliz" | "tranquilo" | "inquieto" | "triste" | "cansado"
      lactancia_estado:
        | "materna"
        | "biberon"
        | "mixta"
        | "finalizada"
        | "no_aplica"
      matricula_estado: "pendiente" | "lista" | "activa" | "baja"
      metodo_pago: "sepa" | "efectivo" | "transferencia"
      modalidad_cobro: "mensual" | "diario"
      momento_comida: "desayuno" | "media_manana" | "comida" | "merienda"
      motivo_ausencia:
        | "enfermedad"
        | "cita_medica"
        | "vacaciones"
        | "familiar"
        | "otro"
      nino_sexo: "F" | "M" | "X"
      olvido_sujeto_tipo: "usuario" | "nino"
      parentesco:
        | "madre"
        | "padre"
        | "abuela"
        | "abuelo"
        | "tia"
        | "tio"
        | "hermana"
        | "hermano"
        | "cuidadora"
        | "otro"
      periodo_informe:
        | "trimestre_1"
        | "trimestre_2"
        | "trimestre_3"
        | "fin_curso"
      politica_firmantes:
        | "uno_principal"
        | "todos_los_principales"
        | "cualquiera"
      recordatorio_destinatario:
        | "familia_individual"
        | "familias_aula"
        | "familias_centro"
        | "profe_individual"
        | "profes_centro"
        | "personal"
      retencion_accion: "simulado" | "purgado"
      retencion_categoria:
        | "dni_recogida"
        | "foto_perfil_nino"
        | "foto_blog_exclusiva"
        | "esqueleto_huerfano"
      rsvp_estado: "pendiente" | "aceptado" | "rechazado"
      servicio_diario: "comedor" | "matinera" | "vespertina"
      tipo_alimentacion:
        | "omnivora"
        | "vegetariana"
        | "vegana"
        | "sin_lactosa"
        | "sin_gluten"
        | "religiosa_halal"
        | "religiosa_kosher"
        | "otra"
      tipo_autorizacion:
        | "salida"
        | "medicacion"
        | "recogida"
        | "reglas_regimen_interno"
        | "autorizacion_imagenes"
      tipo_biberon: "materna" | "formula" | "agua" | "infusion" | "zumo"
      tipo_cita:
        | "reunion_familia"
        | "reunion_clase"
        | "reunion_claustro"
        | "visita"
      tipo_concepto: "mensual" | "diario" | "esporadico"
      tipo_conversacion: "profe_familia" | "admin_familia"
      tipo_deposicion: "pipi" | "caca" | "mixto"
      tipo_dia_centro:
        | "lectivo"
        | "festivo"
        | "vacaciones"
        | "escuela_verano"
        | "escuela_navidad"
        | "jornada_reducida"
        | "cerrado"
      tipo_evento: "excursion" | "reunion" | "fiesta" | "vacaciones" | "otro"
      tipo_personal_aula: "coordinadora" | "profesora" | "tecnico" | "apoyo"
      tipo_plato_comida: "primer_plato" | "segundo_plato" | "postre" | "unico"
      tipo_vinculo:
        | "tutor_legal_principal"
        | "tutor_legal_secundario"
        | "autorizado"
        | "admin"
      user_role: "admin" | "profe" | "tutor_legal" | "autorizado"
      valoracion_item_informe: "conseguido" | "en_proceso" | "no_iniciado"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      ambito_anuncio: ["aula", "centro"],
      ambito_evento: ["centro", "aula", "nino"],
      audit_accion: ["INSERT", "UPDATE", "DELETE"],
      autorizacion_ambito: ["nino", "aula", "centro"],
      autorizacion_estado: ["borrador", "publicada", "anulada"],
      calidad_sueno: ["profundo", "tranquilo", "intermitente", "nada"],
      cantidad_comida: ["todo", "mayoria", "mitad", "poco", "nada"],
      cantidad_deposicion: ["mucha", "normal", "poca"],
      cita_estado: ["programada", "cancelada"],
      confirmacion_estado: ["pendiente", "confirmado", "rechazado"],
      consentimiento_tipo: [
        "terminos",
        "privacidad",
        "imagen",
        "datos_medicos",
      ],
      consistencia_deposicion: ["normal", "dura", "blanda", "diarrea"],
      control_esfinteres: [
        "panal_completo",
        "transicion",
        "sin_panal_diurno",
        "sin_panal_total",
      ],
      curso_estado: ["planificado", "activo", "cerrado"],
      estado_asistencia: [
        "presente",
        "ausente",
        "llegada_tarde",
        "salida_temprana",
      ],
      estado_cambio_pendiente: ["pendiente", "aprobado", "rechazado"],
      estado_campana_informe: ["abierta", "cerrada"],
      estado_civil: [
        "casados",
        "separados",
        "divorciados",
        "pareja_de_hecho",
        "soltero",
        "viudo",
      ],
      estado_general_agenda: ["bien", "regular", "mal", "mixto"],
      estado_informe: ["borrador", "publicado"],
      estado_lista_espera: ["en_espera", "invitado", "descartado"],
      estado_mandato_sepa: ["activo", "revocado"],
      estado_plantilla_informe: ["activa", "archivada"],
      estado_plantilla_menu: ["borrador", "publicada", "archivada"],
      estado_recibo: [
        "pendiente_procesar",
        "enviado_banco",
        "devuelto",
        "cobrado_manual",
      ],
      estado_remesa: ["borrador", "enviada"],
      evento_estado: ["programado", "cancelado"],
      firma_decision: ["firmado", "rechazado", "revocado"],
      firma_metodo: ["digital", "presencial"],
      humor_agenda: ["feliz", "tranquilo", "inquieto", "triste", "cansado"],
      lactancia_estado: [
        "materna",
        "biberon",
        "mixta",
        "finalizada",
        "no_aplica",
      ],
      matricula_estado: ["pendiente", "lista", "activa", "baja"],
      metodo_pago: ["sepa", "efectivo", "transferencia"],
      modalidad_cobro: ["mensual", "diario"],
      momento_comida: ["desayuno", "media_manana", "comida", "merienda"],
      motivo_ausencia: [
        "enfermedad",
        "cita_medica",
        "vacaciones",
        "familiar",
        "otro",
      ],
      nino_sexo: ["F", "M", "X"],
      olvido_sujeto_tipo: ["usuario", "nino"],
      parentesco: [
        "madre",
        "padre",
        "abuela",
        "abuelo",
        "tia",
        "tio",
        "hermana",
        "hermano",
        "cuidadora",
        "otro",
      ],
      periodo_informe: [
        "trimestre_1",
        "trimestre_2",
        "trimestre_3",
        "fin_curso",
      ],
      politica_firmantes: [
        "uno_principal",
        "todos_los_principales",
        "cualquiera",
      ],
      recordatorio_destinatario: [
        "familia_individual",
        "familias_aula",
        "familias_centro",
        "profe_individual",
        "profes_centro",
        "personal",
      ],
      retencion_accion: ["simulado", "purgado"],
      retencion_categoria: [
        "dni_recogida",
        "foto_perfil_nino",
        "foto_blog_exclusiva",
        "esqueleto_huerfano",
      ],
      rsvp_estado: ["pendiente", "aceptado", "rechazado"],
      servicio_diario: ["comedor", "matinera", "vespertina"],
      tipo_alimentacion: [
        "omnivora",
        "vegetariana",
        "vegana",
        "sin_lactosa",
        "sin_gluten",
        "religiosa_halal",
        "religiosa_kosher",
        "otra",
      ],
      tipo_autorizacion: [
        "salida",
        "medicacion",
        "recogida",
        "reglas_regimen_interno",
        "autorizacion_imagenes",
      ],
      tipo_biberon: ["materna", "formula", "agua", "infusion", "zumo"],
      tipo_cita: [
        "reunion_familia",
        "reunion_clase",
        "reunion_claustro",
        "visita",
      ],
      tipo_concepto: ["mensual", "diario", "esporadico"],
      tipo_conversacion: ["profe_familia", "admin_familia"],
      tipo_deposicion: ["pipi", "caca", "mixto"],
      tipo_dia_centro: [
        "lectivo",
        "festivo",
        "vacaciones",
        "escuela_verano",
        "escuela_navidad",
        "jornada_reducida",
        "cerrado",
      ],
      tipo_evento: ["excursion", "reunion", "fiesta", "vacaciones", "otro"],
      tipo_personal_aula: ["coordinadora", "profesora", "tecnico", "apoyo"],
      tipo_plato_comida: ["primer_plato", "segundo_plato", "postre", "unico"],
      tipo_vinculo: [
        "tutor_legal_principal",
        "tutor_legal_secundario",
        "autorizado",
        "admin",
      ],
      user_role: ["admin", "profe", "tutor_legal", "autorizado"],
      valoracion_item_informe: ["conseguido", "en_proceso", "no_iniciado"],
    },
  },
} as const
