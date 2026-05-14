export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      ad_placements: {
        Row: {
          ad_position: Database["public"]["Enums"]["ad_position"]
          ad_size: Database["public"]["Enums"]["ad_size"]
          balance_paid_at: string | null
          business_id: string
          contract_signed_at: string | null
          contract_status: Database["public"]["Enums"]["contract_status"]
          created_at: string
          deposit_paid_at: string | null
          digital_removed_at: string | null
          digital_removed_by_user_id: string | null
          digital_removed_reason: string | null
          guide_id: string
          id: string
          price_cents: number
          print_state: Database["public"]["Enums"]["print_state"]
          pro_rata_refund_cents: number | null
          updated_at: string
        }
        Insert: {
          ad_position?: Database["public"]["Enums"]["ad_position"]
          ad_size: Database["public"]["Enums"]["ad_size"]
          balance_paid_at?: string | null
          business_id: string
          contract_signed_at?: string | null
          contract_status?: Database["public"]["Enums"]["contract_status"]
          created_at?: string
          deposit_paid_at?: string | null
          digital_removed_at?: string | null
          digital_removed_by_user_id?: string | null
          digital_removed_reason?: string | null
          guide_id: string
          id?: string
          price_cents: number
          print_state?: Database["public"]["Enums"]["print_state"]
          pro_rata_refund_cents?: number | null
          updated_at?: string
        }
        Update: {
          ad_position?: Database["public"]["Enums"]["ad_position"]
          ad_size?: Database["public"]["Enums"]["ad_size"]
          balance_paid_at?: string | null
          business_id?: string
          contract_signed_at?: string | null
          contract_status?: Database["public"]["Enums"]["contract_status"]
          created_at?: string
          deposit_paid_at?: string | null
          digital_removed_at?: string | null
          digital_removed_by_user_id?: string | null
          digital_removed_reason?: string | null
          guide_id?: string
          id?: string
          price_cents?: number
          print_state?: Database["public"]["Enums"]["print_state"]
          pro_rata_refund_cents?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_placements_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_placements_digital_removed_by_user_id_fkey"
            columns: ["digital_removed_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_placements_guide_id_fkey"
            columns: ["guide_id"]
            isOneToOne: false
            referencedRelation: "guides"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_revisions: {
        Row: {
          ad_placement_id: string
          approved_at: string | null
          created_at: string
          designer_notes: string | null
          id: string
          rejected_at: string | null
          round_number: number
          submitted_at: string | null
        }
        Insert: {
          ad_placement_id: string
          approved_at?: string | null
          created_at?: string
          designer_notes?: string | null
          id?: string
          rejected_at?: string | null
          round_number: number
          submitted_at?: string | null
        }
        Update: {
          ad_placement_id?: string
          approved_at?: string | null
          created_at?: string
          designer_notes?: string | null
          id?: string
          rejected_at?: string | null
          round_number?: number
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_revisions_ad_placement_id_fkey"
            columns: ["ad_placement_id"]
            isOneToOne: false
            referencedRelation: "ad_placements"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_role: Database["public"]["Enums"]["actor_role"]
          actor_user_id: string | null
          after: Json | null
          before: Json | null
          entity_business_id: string | null
          entity_hotel_id: string | null
          entity_id: string
          entity_type: string
          id: string
          occurred_at: string
        }
        Insert: {
          action: string
          actor_role: Database["public"]["Enums"]["actor_role"]
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          entity_business_id?: string | null
          entity_hotel_id?: string | null
          entity_id: string
          entity_type: string
          id?: string
          occurred_at?: string
        }
        Update: {
          action?: string
          actor_role?: Database["public"]["Enums"]["actor_role"]
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          entity_business_id?: string | null
          entity_hotel_id?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_entity_business_id_fkey"
            columns: ["entity_business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_entity_hotel_id_fkey"
            columns: ["entity_hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
        ]
      }
      brief_assets: {
        Row: {
          brief_id: string
          bytes: number | null
          cloudinary_public_id: string | null
          created_at: string
          exif: Json | null
          height_px: number | null
          id: string
          kind: Database["public"]["Enums"]["brief_asset_kind"]
          storage_path: string | null
          uploaded_at: string
          width_px: number | null
        }
        Insert: {
          brief_id: string
          bytes?: number | null
          cloudinary_public_id?: string | null
          created_at?: string
          exif?: Json | null
          height_px?: number | null
          id?: string
          kind: Database["public"]["Enums"]["brief_asset_kind"]
          storage_path?: string | null
          uploaded_at?: string
          width_px?: number | null
        }
        Update: {
          brief_id?: string
          bytes?: number | null
          cloudinary_public_id?: string | null
          created_at?: string
          exif?: Json | null
          height_px?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["brief_asset_kind"]
          storage_path?: string | null
          uploaded_at?: string
          width_px?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "brief_assets_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "briefs"
            referencedColumns: ["id"]
          },
        ]
      }
      brief_mood_selections: {
        Row: {
          brief_id: string
          created_at: string
          mood_option_id: string
          selection_order: number
        }
        Insert: {
          brief_id: string
          created_at?: string
          mood_option_id: string
          selection_order: number
        }
        Update: {
          brief_id?: string
          created_at?: string
          mood_option_id?: string
          selection_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "brief_mood_selections_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brief_mood_selections_mood_option_id_fkey"
            columns: ["mood_option_id"]
            isOneToOne: false
            referencedRelation: "active_mood_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brief_mood_selections_mood_option_id_fkey"
            columns: ["mood_option_id"]
            isOneToOne: false
            referencedRelation: "mood_options"
            referencedColumns: ["id"]
          },
        ]
      }
      briefs: {
        Row: {
          ad_placement_id: string
          created_at: string
          data: Json
          id: string
          locked_at: string | null
          signed_off_at: string | null
          status: Database["public"]["Enums"]["brief_status"]
          submitted_at: string | null
          track: Database["public"]["Enums"]["brief_track"]
          updated_at: string
        }
        Insert: {
          ad_placement_id: string
          created_at?: string
          data?: Json
          id?: string
          locked_at?: string | null
          signed_off_at?: string | null
          status?: Database["public"]["Enums"]["brief_status"]
          submitted_at?: string | null
          track: Database["public"]["Enums"]["brief_track"]
          updated_at?: string
        }
        Update: {
          ad_placement_id?: string
          created_at?: string
          data?: Json
          id?: string
          locked_at?: string | null
          signed_off_at?: string | null
          status?: Database["public"]["Enums"]["brief_status"]
          submitted_at?: string | null
          track?: Database["public"]["Enums"]["brief_track"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "briefs_ad_placement_id_fkey"
            columns: ["ad_placement_id"]
            isOneToOne: true
            referencedRelation: "ad_placements"
            referencedColumns: ["id"]
          },
        ]
      }
      business_users: {
        Row: {
          accepted_at: string | null
          business_id: string
          created_at: string
          id: string
          invited_by: string | null
          invited_email: string
          is_admin: boolean
          revoked_at: string | null
          revoked_by: string | null
          user_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          business_id: string
          created_at?: string
          id?: string
          invited_by?: string | null
          invited_email: string
          is_admin?: boolean
          revoked_at?: string | null
          revoked_by?: string | null
          user_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          business_id?: string
          created_at?: string
          id?: string
          invited_by?: string | null
          invited_email?: string
          is_admin?: boolean
          revoked_at?: string | null
          revoked_by?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_users_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_users_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_users_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          address: string | null
          created_at: string
          display_name: string
          id: string
          legal_name: string
          phone: string | null
          social_handles: Json
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          display_name: string
          id?: string
          legal_name: string
          phone?: string | null
          social_handles?: Json
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          display_name?: string
          id?: string
          legal_name?: string
          phone?: string | null
          social_handles?: Json
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      candidate_businesses: {
        Row: {
          address: string | null
          category: string | null
          contact_email: string | null
          created_at: string
          decided_at: string | null
          decided_by_user_id: string | null
          distance_m: number | null
          google_place_id: string | null
          hotel_id: string
          id: string
          linked_business_id: string | null
          name: string
          phone: string | null
          proposed_at: string
          proposed_by: string | null
          removal_reason: string | null
          removed_at: string | null
          removed_by: string | null
          source: Database["public"]["Enums"]["candidate_source"]
          status: Database["public"]["Enums"]["candidate_status"]
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          category?: string | null
          contact_email?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by_user_id?: string | null
          distance_m?: number | null
          google_place_id?: string | null
          hotel_id: string
          id?: string
          linked_business_id?: string | null
          name: string
          phone?: string | null
          proposed_at?: string
          proposed_by?: string | null
          removal_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          source: Database["public"]["Enums"]["candidate_source"]
          status?: Database["public"]["Enums"]["candidate_status"]
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          category?: string | null
          contact_email?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by_user_id?: string | null
          distance_m?: number | null
          google_place_id?: string | null
          hotel_id?: string
          id?: string
          linked_business_id?: string | null
          name?: string
          phone?: string | null
          proposed_at?: string
          proposed_by?: string | null
          removal_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          source?: Database["public"]["Enums"]["candidate_source"]
          status?: Database["public"]["Enums"]["candidate_status"]
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "candidate_businesses_decided_by_user_id_fkey"
            columns: ["decided_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_businesses_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_businesses_linked_business_id_fkey"
            columns: ["linked_business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_businesses_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_businesses_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          ad_position: Database["public"]["Enums"]["ad_position"] | null
          ad_size: Database["public"]["Enums"]["ad_size"] | null
          browser: string | null
          business_id: string | null
          category: string | null
          country: string | null
          device_type: Database["public"]["Enums"]["device_type"] | null
          event_id: string
          event_type: Database["public"]["Enums"]["event_type"]
          guide_id: string | null
          hotel_id: string | null
          occurred_at: string
          offer_code: string | null
          os: string | null
          outbound_destination:
            | Database["public"]["Enums"]["outbound_destination"]
            | null
          page_type: string | null
          qr_code_id: string | null
          redemption_method:
            | Database["public"]["Enums"]["redemption_method"]
            | null
          referrer_type: Database["public"]["Enums"]["referrer_type"] | null
          region: string | null
          serving_domain: string
          session_id: string
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          ad_position?: Database["public"]["Enums"]["ad_position"] | null
          ad_size?: Database["public"]["Enums"]["ad_size"] | null
          browser?: string | null
          business_id?: string | null
          category?: string | null
          country?: string | null
          device_type?: Database["public"]["Enums"]["device_type"] | null
          event_id?: string
          event_type: Database["public"]["Enums"]["event_type"]
          guide_id?: string | null
          hotel_id?: string | null
          occurred_at?: string
          offer_code?: string | null
          os?: string | null
          outbound_destination?:
            | Database["public"]["Enums"]["outbound_destination"]
            | null
          page_type?: string | null
          qr_code_id?: string | null
          redemption_method?:
            | Database["public"]["Enums"]["redemption_method"]
            | null
          referrer_type?: Database["public"]["Enums"]["referrer_type"] | null
          region?: string | null
          serving_domain: string
          session_id: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          ad_position?: Database["public"]["Enums"]["ad_position"] | null
          ad_size?: Database["public"]["Enums"]["ad_size"] | null
          browser?: string | null
          business_id?: string | null
          category?: string | null
          country?: string | null
          device_type?: Database["public"]["Enums"]["device_type"] | null
          event_id?: string
          event_type?: Database["public"]["Enums"]["event_type"]
          guide_id?: string | null
          hotel_id?: string | null
          occurred_at?: string
          offer_code?: string | null
          os?: string | null
          outbound_destination?:
            | Database["public"]["Enums"]["outbound_destination"]
            | null
          page_type?: string | null
          qr_code_id?: string | null
          redemption_method?:
            | Database["public"]["Enums"]["redemption_method"]
            | null
          referrer_type?: Database["public"]["Enums"]["referrer_type"] | null
          region?: string | null
          serving_domain?: string
          session_id?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_guide_id_fkey"
            columns: ["guide_id"]
            isOneToOne: false
            referencedRelation: "guides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_qr_code_id_fkey"
            columns: ["qr_code_id"]
            isOneToOne: false
            referencedRelation: "qr_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      events_daily: {
        Row: {
          breakdowns: Json
          business_id: string | null
          count: number
          day: string
          event_type: Database["public"]["Enums"]["event_type"]
          guide_id: string | null
          hotel_id: string
          unique_session_count: number
        }
        Insert: {
          breakdowns?: Json
          business_id?: string | null
          count?: number
          day: string
          event_type: Database["public"]["Enums"]["event_type"]
          guide_id?: string | null
          hotel_id: string
          unique_session_count?: number
        }
        Update: {
          breakdowns?: Json
          business_id?: string | null
          count?: number
          day?: string
          event_type?: Database["public"]["Enums"]["event_type"]
          guide_id?: string | null
          hotel_id?: string
          unique_session_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "events_daily_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_daily_guide_id_fkey"
            columns: ["guide_id"]
            isOneToOne: false
            referencedRelation: "guides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_daily_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
        ]
      }
      events_hourly: {
        Row: {
          business_id: string | null
          count: number
          event_type: Database["public"]["Enums"]["event_type"]
          guide_id: string | null
          hotel_id: string
          hour: string
          unique_session_count: number
        }
        Insert: {
          business_id?: string | null
          count?: number
          event_type: Database["public"]["Enums"]["event_type"]
          guide_id?: string | null
          hotel_id: string
          hour: string
          unique_session_count?: number
        }
        Update: {
          business_id?: string | null
          count?: number
          event_type?: Database["public"]["Enums"]["event_type"]
          guide_id?: string | null
          hotel_id?: string
          hour?: string
          unique_session_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "events_hourly_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_hourly_guide_id_fkey"
            columns: ["guide_id"]
            isOneToOne: false
            referencedRelation: "guides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_hourly_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
        ]
      }
      events_monthly: {
        Row: {
          breakdowns: Json
          business_id: string | null
          count: number
          event_type: Database["public"]["Enums"]["event_type"]
          guide_id: string | null
          hotel_id: string
          mom_delta: number | null
          unique_session_count: number
          year_month: string
        }
        Insert: {
          breakdowns?: Json
          business_id?: string | null
          count?: number
          event_type: Database["public"]["Enums"]["event_type"]
          guide_id?: string | null
          hotel_id: string
          mom_delta?: number | null
          unique_session_count?: number
          year_month: string
        }
        Update: {
          breakdowns?: Json
          business_id?: string | null
          count?: number
          event_type?: Database["public"]["Enums"]["event_type"]
          guide_id?: string | null
          hotel_id?: string
          mom_delta?: number | null
          unique_session_count?: number
          year_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_monthly_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_monthly_guide_id_fkey"
            columns: ["guide_id"]
            isOneToOne: false
            referencedRelation: "guides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_monthly_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
        ]
      }
      guides: {
        Row: {
          created_at: string
          hotel_id: string
          id: string
          mid_term_change_window_closes_on: string | null
          mid_term_change_window_opens_on: string | null
          print_run_count: number
          printed_at: string | null
          status: Database["public"]["Enums"]["guide_status"]
          term_ends_on: string
          term_starts_on: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          hotel_id: string
          id?: string
          mid_term_change_window_closes_on?: string | null
          mid_term_change_window_opens_on?: string | null
          print_run_count?: number
          printed_at?: string | null
          status?: Database["public"]["Enums"]["guide_status"]
          term_ends_on: string
          term_starts_on: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          hotel_id?: string
          id?: string
          mid_term_change_window_closes_on?: string | null
          mid_term_change_window_opens_on?: string | null
          print_run_count?: number
          printed_at?: string | null
          status?: Database["public"]["Enums"]["guide_status"]
          term_ends_on?: string
          term_starts_on?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guides_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
        ]
      }
      hotel_users: {
        Row: {
          accepted_at: string | null
          created_at: string
          hotel_id: string
          id: string
          invited_by: string | null
          invited_email: string
          is_admin: boolean
          revoked_at: string | null
          revoked_by: string | null
          user_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          hotel_id: string
          id?: string
          invited_by?: string | null
          invited_email: string
          is_admin?: boolean
          revoked_at?: string | null
          revoked_by?: string | null
          user_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          hotel_id?: string
          id?: string
          invited_by?: string | null
          invited_email?: string
          is_admin?: boolean
          revoked_at?: string | null
          revoked_by?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hotel_users_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_users_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_users_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotel_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      hotels: {
        Row: {
          approval_state: Database["public"]["Enums"]["hotel_approval_state"]
          candidate_list_approval_due_at: string | null
          candidate_list_approved_at: string | null
          contact_email: string
          created_at: string
          custom_domain: string | null
          design_meeting_at: string | null
          final_guide_approval_due_at: string | null
          final_guide_approved_at: string | null
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          approval_state?: Database["public"]["Enums"]["hotel_approval_state"]
          candidate_list_approval_due_at?: string | null
          candidate_list_approved_at?: string | null
          contact_email: string
          created_at?: string
          custom_domain?: string | null
          design_meeting_at?: string | null
          final_guide_approval_due_at?: string | null
          final_guide_approved_at?: string | null
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          approval_state?: Database["public"]["Enums"]["hotel_approval_state"]
          candidate_list_approval_due_at?: string | null
          candidate_list_approved_at?: string | null
          contact_email?: string
          created_at?: string
          custom_domain?: string | null
          design_meeting_at?: string | null
          final_guide_approval_due_at?: string | null
          final_guide_approved_at?: string | null
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      mood_options: {
        Row: {
          created_at: string
          description: string
          design_treatment_notes: string
          id: string
          label: string
          reference_image_cloudinary_ids: string[]
          retired_at: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          design_treatment_notes: string
          id?: string
          label: string
          reference_image_cloudinary_ids?: string[]
          retired_at?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          design_treatment_notes?: string
          id?: string
          label?: string
          reference_image_cloudinary_ids?: string[]
          retired_at?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      print_change_requests: {
        Row: {
          applied_at: string | null
          created_at: string
          guide_id: string
          id: string
          notes: string | null
          requested_at: string
          requested_by_user_id: string | null
        }
        Insert: {
          applied_at?: string | null
          created_at?: string
          guide_id: string
          id?: string
          notes?: string | null
          requested_at?: string
          requested_by_user_id?: string | null
        }
        Update: {
          applied_at?: string | null
          created_at?: string
          guide_id?: string
          id?: string
          notes?: string | null
          requested_at?: string
          requested_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "print_change_requests_guide_id_fkey"
            columns: ["guide_id"]
            isOneToOne: false
            referencedRelation: "guides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_change_requests_requested_by_user_id_fkey"
            columns: ["requested_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      qr_codes: {
        Row: {
          business_id: string | null
          created_at: string
          generated_at: string
          guide_id: string
          id: string
          placement_kind: Database["public"]["Enums"]["qr_placement_kind"]
          sequence_in_manifest: number
          target_url: string
        }
        Insert: {
          business_id?: string | null
          created_at?: string
          generated_at?: string
          guide_id: string
          id?: string
          placement_kind: Database["public"]["Enums"]["qr_placement_kind"]
          sequence_in_manifest: number
          target_url: string
        }
        Update: {
          business_id?: string | null
          created_at?: string
          generated_at?: string
          guide_id?: string
          id?: string
          placement_kind?: Database["public"]["Enums"]["qr_placement_kind"]
          sequence_in_manifest?: number
          target_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "qr_codes_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_codes_guide_id_fkey"
            columns: ["guide_id"]
            isOneToOne: false
            referencedRelation: "guides"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_concerns: {
        Row: {
          ad_placement_id: string
          id: string
          raised_at: string
          raised_by_user_id: string | null
          resolution_notes: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["quality_concern_status"]
        }
        Insert: {
          ad_placement_id: string
          id?: string
          raised_at?: string
          raised_by_user_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["quality_concern_status"]
        }
        Update: {
          ad_placement_id?: string
          id?: string
          raised_at?: string
          raised_by_user_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["quality_concern_status"]
        }
        Relationships: [
          {
            foreignKeyName: "quality_concerns_ad_placement_id_fkey"
            columns: ["ad_placement_id"]
            isOneToOne: false
            referencedRelation: "ad_placements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_concerns_raised_by_user_id_fkey"
            columns: ["raised_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      self_supplied_ads: {
        Row: {
          ad_placement_id: string
          approved_at: string | null
          created_at: string
          id: string
          rejected_at: string | null
          rejection_reason: string | null
          reviewed_at: string | null
          storage_path: string
          submitted_at: string | null
        }
        Insert: {
          ad_placement_id: string
          approved_at?: string | null
          created_at?: string
          id?: string
          rejected_at?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          storage_path: string
          submitted_at?: string | null
        }
        Update: {
          ad_placement_id?: string
          approved_at?: string | null
          created_at?: string
          id?: string
          rejected_at?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          storage_path?: string
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "self_supplied_ads_ad_placement_id_fkey"
            columns: ["ad_placement_id"]
            isOneToOne: true
            referencedRelation: "ad_placements"
            referencedColumns: ["id"]
          },
        ]
      }
      strictons_staff: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "strictons_staff_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          display_name: string | null
          email: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email: string
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      active_mood_options: {
        Row: {
          created_at: string | null
          description: string | null
          design_treatment_notes: string | null
          id: string | null
          label: string | null
          reference_image_cloudinary_ids: string[] | null
          slug: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          design_treatment_notes?: string | null
          id?: string | null
          label?: string | null
          reference_image_cloudinary_ids?: string[] | null
          slug?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          design_treatment_notes?: string | null
          id?: string | null
          label?: string | null
          reference_image_cloudinary_ids?: string[] | null
          slug?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      is_business_admin: {
        Args: {
          p_business_id: string
        }
        Returns: boolean
      }
      is_business_user: {
        Args: {
          p_business_id: string
        }
        Returns: boolean
      }
      is_hotel_admin: {
        Args: {
          p_hotel_id: string
        }
        Returns: boolean
      }
      is_hotel_user: {
        Args: {
          p_hotel_id: string
        }
        Returns: boolean
      }
      is_strictons_staff: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_url_safe_slug: {
        Args: {
          value: string
        }
        Returns: boolean
      }
      is_valid_social_handles: {
        Args: {
          p_handles: Json
        }
        Returns: boolean
      }
    }
    Enums: {
      actor_role:
        | "strictons_staff"
        | "hotel_admin"
        | "hotel_user"
        | "business_admin"
        | "business_user"
        | "system"
        | "anonymous"
      ad_position:
        | "standard"
        | "premium_inside_front"
        | "premium_inside_back"
        | "premium_other"
      ad_size: "quarter" | "half" | "full"
      brief_asset_kind:
        | "logo_vector"
        | "logo_raster"
        | "hero_photo"
        | "brand_guidelines_pdf"
        | "reference_ad"
      brief_status: "draft" | "submitted" | "locked" | "in_design"
      brief_track:
        | "quarter"
        | "half_treatment_a"
        | "half_treatment_b"
        | "half_treatment_c"
        | "full"
        | "self_supplied"
      candidate_source: "google_places" | "csv" | "manual"
      candidate_status:
        | "proposed"
        | "approved"
        | "removed_by_hotel"
        | "signed_to_placement"
        | "removed_by_strictons"
      contract_status:
        | "invited"
        | "signed_pending_deposit"
        | "signed"
        | "completed"
        | "cancelled"
      device_type: "mobile" | "tablet" | "desktop"
      event_type:
        | "page_view"
        | "qr_scan"
        | "outbound_click"
        | "offer_redemption"
        | "phone_tap"
        | "directions_tap"
        | "social_click"
        | "booking_link_click"
      guide_status: "design" | "in_print" | "distributing" | "expired"
      hotel_approval_state:
        | "pending_design_meeting"
        | "design_meeting_held"
        | "candidate_list_drafted"
        | "candidate_list_with_hotel"
        | "candidate_list_approved"
        | "paused_awaiting_hotel_response"
        | "businesses_pitching"
        | "final_guide_with_hotel"
        | "final_guide_approved"
        | "in_print"
        | "distributing"
      outbound_destination:
        | "booking"
        | "social_instagram"
        | "social_facebook"
        | "social_tiktok"
        | "social_other"
        | "website"
        | "phone"
        | "directions"
      print_state: "not_yet_printed" | "printed"
      qr_placement_kind:
        | "welcome"
        | "map"
        | "business_listing"
        | "amenity"
        | "room_service"
        | "events"
        | "other"
      quality_concern_status: "review_requested" | "dismissed" | "action_taken"
      redemption_method: "business_portal_entry" | "geo_confirmed"
      referrer_type:
        | "qr_scan"
        | "pre_arrival_email"
        | "direct"
        | "internal_navigation"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof PublicSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof PublicSchema["CompositeTypes"]
    ? PublicSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

