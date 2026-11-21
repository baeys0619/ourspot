-- 빈 MySQL 데이터 디렉터리에서만 공식 entrypoint가 실행한다.
-- 사용자 암호/seed는 포함하지 않는다. 비공개 입력을 받는 계정 설치는 인증 단계에서 구현한다.
SET NAMES utf8mb4;
SET time_zone = '+00:00';
CREATE TABLE users (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 email VARCHAR(254) NOT NULL UNIQUE,
 password_hash VARCHAR(255) NOT NULL,
 display_name VARCHAR(80) NOT NULL,
 couple_id VARCHAR(64) NOT NULL,
 INDEX idx_users_couple (couple_id, id)
) ENGINE=InnoDB;
CREATE TABLE places (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 couple_id VARCHAR(64) NOT NULL,
 added_by INT NOT NULL,
 title VARCHAR(120) NOT NULL,
 category ENUM('카페','맛집','놀거리','기타') NOT NULL,
 source_url VARCHAR(2048) NULL,
 memo TEXT NULL,
 planned_date DATE NULL,
 visit_order INT NULL,
 is_visited BOOLEAN NOT NULL DEFAULT FALSE,
 visited_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 -- 변경 시 단조 증가 갱신은 향후 API가 트랜잭션 안에서 명시적으로 수행한다.
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY (added_by) REFERENCES users(id),
 INDEX idx_places_couple_status_created (couple_id, is_visited, created_at, id),
 INDEX idx_places_couple_date_order (couple_id, planned_date, visit_order, id),
 CONSTRAINT chk_places_schedule CHECK ((planned_date IS NULL AND visit_order IS NULL) OR (planned_date IS NOT NULL AND visit_order IS NOT NULL AND visit_order > 0))
) ENGINE=InnoDB;
CREATE TABLE place_comments (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 place_id INT NOT NULL,
 user_id INT NOT NULL,
 phase ENUM('before','after') NOT NULL,
 content TEXT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_comment (place_id, user_id, phase),
 FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE CASCADE,
 FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;
