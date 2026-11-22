-- 빈 MySQL 데이터 디렉터리에서만 공식 entrypoint가 실행한다.
-- 스키마만 만든다. 초기 사용자 두 명은 seed-users.sh에서 전달한 비밀번호를 해시해 별도로 설치한다.
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
-- 장소 접근 범위는 couple_id로 제한하고 added_by는 등록자 표시와 사용자 참조에 사용한다.
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
 -- 기본값은 등록 시 쓰며, 이후 변경은 Place API가 밀리초 단위로 버전을 올린다.
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY (added_by) REFERENCES users(id),
 INDEX idx_places_couple_status_created (couple_id, is_visited, created_at, id),
 INDEX idx_places_couple_date_order (couple_id, planned_date, visit_order, id),
 -- 날짜를 지정한 장소에는 양의 순서가 필요하다. 일정을 비우면 두 값을 함께 NULL로 둔다.
 CONSTRAINT chk_places_schedule CHECK ((planned_date IS NULL AND visit_order IS NULL) OR (planned_date IS NOT NULL AND visit_order IS NOT NULL AND visit_order > 0))
) ENGINE=InnoDB;
-- 한 장소에서 같은 작성자가 단계마다 한 건만 저장할 수 있다. 장소를 삭제하면 두 사람의 코멘트도 함께 삭제된다.
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
